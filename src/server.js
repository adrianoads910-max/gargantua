'use strict';
// Local server: static page + a snapshot of the galaxy every second over Server-Sent Events.
// Binds to 127.0.0.1 only; the Host allowlist blocks DNS rebinding; the CSP allows nothing but this origin.
// Sending a prompt (POST /api/send) also needs the per-run SameSite=Strict cookie, a custom header (no simple
// cross-site request can carry it) and a local Origin.

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const send = require('./send');

const PUBLIC = path.join(__dirname, '..', 'public');
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon', '.mp3': 'audio/mpeg' };
const CSP = "default-src 'self'; img-src 'self' data:; style-src 'self'; style-src-attr 'unsafe-inline'; script-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'";

function start({ port = 4848, demo = false } = {}) {
  const source = demo ? require('./demo') : require('./collect');
  const clients = new Set();
  const TOKEN = crypto.randomBytes(24).toString('hex');
  let last = '';
  const snap = () => Object.assign(source.snapshot(send.active()), { runs: send.list() });

  function tick() {
    let body;
    try { body = JSON.stringify(snap()); } catch (e) { body = JSON.stringify({ error: String(e && e.message || e) }); }
    if (body === last && clients.size) { for (const res of clients) res.write(': ping\n\n'); return; }
    last = body;
    for (const res of clients) res.write('data: ' + body + '\n\n');
  }
  const timer = setInterval(tick, 1000);

  const server = http.createServer((req, res) => {
    const host = String(req.headers.host || '').replace(/:\d+$/, '');
    if (!['127.0.0.1', 'localhost', '[::1]'].includes(host)) { res.writeHead(403); return res.end('forbidden host'); }
    res.setHeader('Content-Security-Policy', CSP);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const url = new URL(req.url, 'http://127.0.0.1');

    if (url.pathname === '/events') {
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store', Connection: 'keep-alive' });
      clients.add(res);
      res.write('data: ' + (last || JSON.stringify(snap())) + '\n\n');
      req.on('close', () => clients.delete(res));
      return;
    }
    if (url.pathname === '/api/snapshot') return json(res, snap());
    if (url.pathname === '/api/send') {
      const cookie = /(?:^|;\s*)g_token=([a-f0-9]+)/.exec(req.headers.cookie || '');
      const origin = req.headers.origin || '';
      if (req.method !== 'POST' || req.headers['x-gargantua'] !== '1' || !cookie || cookie[1] !== TOKEN || (origin && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(origin))) {
        res.writeHead(403); return res.end();
      }
      let body = '';
      req.on('data', c => { body += c; if (body.length > 40000) req.destroy(); });
      req.on('end', () => {
        let msg = {};
        try { msg = JSON.parse(body); } catch {}
        json(res, transmit(msg));
      });
      return;
    }
    const m = /^\/api\/session\/([\w-]{1,80})$/.exec(url.pathname);
    if (m) {
      const d = source.details(m[1], send.active());
      return d ? json(res, d) : json(res, { error: 'not found' }, 404);
    }

    if (url.pathname === '/') res.setHeader('Set-Cookie', `g_token=${TOKEN}; Path=/; HttpOnly; SameSite=Strict`);
    let file = url.pathname === '/' ? '/index.html' : decodeURIComponent(url.pathname);
    const full = path.normalize(path.join(PUBLIC, file));
    if (!full.startsWith(PUBLIC + path.sep)) { res.writeHead(403); return res.end(); }
    fs.stat(full, (err, st) => {
      if (err || !st.isFile()) { res.writeHead(404); return res.end('not found'); }
      const type = TYPES[path.extname(full)] || 'application/octet-stream';
      // audio is fetched in ranges (seeking, looping)
      const range = /^bytes=(\d*)-(\d*)$/.exec(req.headers.range || '');
      if (range && (range[1] || range[2])) {
        let a = range[1] ? Number(range[1]) : Math.max(0, st.size - Number(range[2]));
        let b = range[1] && range[2] ? Math.min(Number(range[2]), st.size - 1) : st.size - 1;
        if (a > b || a >= st.size) { res.writeHead(416, { 'Content-Range': `bytes */${st.size}` }); return res.end(); }
        res.writeHead(206, { 'Content-Type': type, 'Content-Range': `bytes ${a}-${b}/${st.size}`, 'Content-Length': b - a + 1, 'Accept-Ranges': 'bytes', 'Cache-Control': 'max-age=3600' });
        return fs.createReadStream(full, { start: a, end: b }).pipe(res);
      }
      res.writeHead(200, { 'Content-Type': type, 'Content-Length': st.size, 'Accept-Ranges': 'bytes', 'Cache-Control': type.startsWith('audio/') ? 'max-age=3600' : 'no-cache' });
      fs.createReadStream(full).pipe(res);
    });
  });

  // which session or repository a prompt goes to is decided here, from the server's own snapshot
  function transmit(msg) {
    const kind = msg.kind === 'repo' || msg.kind === 'session' ? msg.kind : '';
    const id = String(msg.id || ''), text = String(msg.text || ''), mode = String(msg.mode || '');
    if (!kind) return { ok: false, reason: 'kind' };
    const s = source.snapshot(send.active());
    if (kind === 'repo') {
      const p = s.planets.find(x => x.id === id);
      if (!p) return { ok: false, reason: 'gone' };
      return demo ? send.fake({ kind, id, text, mode }) : send.start({ kind, id, text, mode, cwd: p.id });
    }
    const ses = s.planets.flatMap(p => p.sessions).find(x => x.id === id);
    if (!ses) return { ok: false, reason: 'gone' };
    if (send.active().some(r => r.session === id)) return { ok: false, reason: 'busy' };
    if (demo) return send.fake({ kind, id, text, mode });
    const live = require('./collect').registry().has(id);
    return send.start({ kind, id, text, mode, cwd: ses.cwd, live });
  }

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const addr = server.address();
      resolve({ server, url: `http://127.0.0.1:${addr.port}/${demo ? '?demo=1' : ''}`, close: () => { clearInterval(timer); for (const c of clients) c.end(); server.close(); } });
    });
  });
}

function json(res, obj, code = 200) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}

module.exports = { start };
