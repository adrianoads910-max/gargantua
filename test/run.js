'use strict';
// Zero-dependency tests: node test/run.js
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gargantua-test-'));

// ---- transcript reading ----
const { read, newestPending, short } = require('../src/transcript');
const line = o => JSON.stringify(o) + '\n';

test('transcript: last prompt, reply, model and pending tool', () => {
  const f = path.join(tmp, 'a.jsonl');
  fs.writeFileSync(f,
    line({ type: 'user', cwd: '/r', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: 'first question' } }) +
    line({ type: 'assistant', timestamp: '2026-01-01T00:00:01Z', message: { id: 'm1', model: 'claude-opus-5-5', usage: { output_tokens: 10, input_tokens: 5 }, content: [{ type: 'text', text: 'first answer' }] } }) +
    line({ type: 'user', timestamp: '2026-01-01T00:01:00Z', message: { role: 'user', content: [{ type: 'text', text: 'second question' }] } }) +
    line({ type: 'assistant', timestamp: '2026-01-01T00:01:01Z', message: { id: 'm2', model: 'claude-opus-5-5', usage: { output_tokens: 7 }, content: [{ type: 'text', text: 'working on it' }, { type: 'tool_use', id: 't1', name: 'Bash', input: { description: 'Run the tests' } }] } }));
  const st = read(f);
  assert.strictEqual(st.lastPrompt, 'second question');
  assert.strictEqual(st.firstPrompt, 'first question');
  assert.strictEqual(st.reply, 'working on it');
  assert.strictEqual(st.model, 'claude-opus-5-5');
  assert.strictEqual(st.turns, 2);
  assert.strictEqual(st.tokensOut, 17);
  const p = newestPending(st);
  assert.strictEqual(p.name, 'Bash');
  assert.strictEqual(p.kind, 'terminal');
  // the tool result arrives: nothing pending; appended bytes are read incrementally
  fs.appendFileSync(f, line({ type: 'user', message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ok' }] } }));
  assert.strictEqual(newestPending(read(f)), null);
  assert.strictEqual(read(f).lastPrompt, 'second question', 'a tool result is not a prompt');
});

test('transcript: injected text is not a prompt', () => {
  const f = path.join(tmp, 'b.jsonl');
  fs.writeFileSync(f,
    line({ type: 'user', message: { content: 'real one' } }) +
    line({ type: 'user', message: { content: '<command-name>/clear</command-name>' } }) +
    line({ type: 'user', isMeta: true, message: { content: 'meta' } }) +
    line({ type: 'user', message: { content: '[Request interrupted by user]' } }));
  assert.strictEqual(read(f).lastPrompt, 'real one');
});

test('transcript: secrets are masked', () => {
  assert.ok(!short('export API_KEY=sk-123456789 && run', 200).includes('sk-123456789'));
  assert.ok(!short('curl -H "Authorization: Bearer abcdefghijklmnop"', 200).includes('abcdefghijklmnop'));
});

// ---- the galaxy model ----
const { build, statusOf } = require('../src/collect');

test('collect: status from registry and transcript', () => {
  const now = Date.now();
  const st = (o = {}) => Object.assign({ pending: new Map(), turnOpen: false, mtime: now - 60000 }, o);
  assert.strictEqual(statusOf(null, st(), now), 'dormant');
  assert.strictEqual(statusOf({ status: 'busy' }, st(), now), 'working');
  assert.strictEqual(statusOf({ status: 'idle' }, st(), now), 'idle');
  const ask = new Map([['x', { kind: 'ask', ts: now }]]);
  assert.strictEqual(statusOf({ status: 'busy' }, st({ pending: ask }), now), 'ask');
  const stuck = new Map([['y', { kind: 'terminal', ts: now - 20000 }]]);
  assert.strictEqual(statusOf({ status: 'idle' }, st({ pending: stuck, turnOpen: true }), now), 'ask', 'a tool pending while idle = a permission prompt');
});

test('collect: sessions grouped by repository; you go where you are called', () => {
  const s = (id, planet, status, lastPromptAt) => ({ id, planet, planetName: path.basename(planet), status, lastTs: lastPromptAt, lastPromptAt, subagents: [], tokensOut: 1, model: 'm' });
  const snap = build([s('a', '/r/one', 'idle', 10), s('b', '/r/one', 'ask', 5), s('c', '/r/two', 'working', 20)], Date.now());
  assert.deepStrictEqual(snap.planets.map(p => p.name), ['one', 'two']);
  assert.strictEqual(snap.planets[0].sessions.length, 2);
  assert.strictEqual(snap.you.session, 'b');
  assert.strictEqual(snap.you.waiting, true);
  assert.deepStrictEqual([snap.claude.working, snap.claude.ask, snap.claude.idle], [1, 1, 1]);
});

// ---- transmissions ----
const send = require('../src/send');

test('send: refuses bad input before running anything', () => {
  assert.strictEqual(send.start({ kind: 'repo', id: tmp, text: '', mode: 'plan', cwd: tmp }).reason, 'text');
  assert.strictEqual(send.start({ kind: 'repo', id: tmp, text: 'x'.repeat(9000), mode: 'plan', cwd: tmp }).reason, 'text');
  assert.strictEqual(send.start({ kind: 'repo', id: tmp, text: 'hi', mode: 'bypassPermissions', cwd: tmp }).reason, 'mode');
  assert.strictEqual(send.start({ kind: 'repo', id: tmp, text: 'hi', mode: 'plan', cwd: path.join(tmp, 'nope') }).reason, 'nodir');
});

test('send: builds the right claude command (fake binary)', async () => {
  const bin = path.join(tmp, 'fake-claude');
  fs.writeFileSync(bin, '#!/bin/sh\nprintf "%s\\n" "$@"\n', { mode: 0o755 });
  process.env.GARGANTUA_CLAUDE = bin;
  const wait = r => new Promise(res => { const t = setInterval(() => { const x = send.list().find(y => y.id === r.run.id); if (x.status !== 'running') { clearInterval(t); res(x); } }, 20); });
  const fresh = await wait(send.start({ kind: 'repo', id: tmp, text: 'hello; rm -rf /', mode: 'plan', cwd: tmp }));
  const args = fresh.out.trim().split('\n');
  assert.deepStrictEqual(args.slice(0, 4), ['-p', 'hello; rm -rf /', '--permission-mode', 'plan'], 'the prompt travels as one argument, never through a shell');
  assert.strictEqual(args[4], '--session-id');
  const resumed = await wait(send.start({ kind: 'session', id: 'abc', text: 'go', mode: 'acceptEdits', cwd: tmp, live: false }));
  assert.ok(resumed.out.includes('--resume\nabc'));
  assert.ok(!resumed.out.includes('--fork-session'));
  const forked = await wait(send.start({ kind: 'session', id: 'abc', text: 'go', mode: 'acceptEdits', cwd: tmp, live: true }));
  assert.ok(forked.out.includes('--fork-session'), 'an open session is forked, not written to');
  delete process.env.GARGANTUA_CLAUDE;
});

// ---- the server ----
function req(port, opts) {
  return new Promise((resolve, reject) => {
    const r = http.request(Object.assign({ host: '127.0.0.1', port, headers: {} }, opts), res => {
      let body = '';
      res.on('data', c => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body }));
    });
    r.on('error', reject);
    if (opts.body) r.write(opts.body);
    r.end();
  });
}

test('server: host allowlist, CSP, cookie-guarded send, ranges', async () => {
  const { start } = require('../src/server');
  const srv = await start({ port: 0, demo: true });
  const port = srv.server.address().port;
  try {
    assert.strictEqual((await req(port, { path: '/', headers: { host: 'evil.example' } })).status, 403);
    const home = await req(port, { path: '/' });
    assert.strictEqual(home.status, 200);
    assert.ok(/default-src 'self'/.test(home.headers['content-security-policy']));
    const cookie = (home.headers['set-cookie'] || [''])[0].split(';')[0];
    assert.ok(/^g_token=[a-f0-9]{48}$/.test(cookie));
    assert.ok(/SameSite=Strict/.test(home.headers['set-cookie'][0]));

    const snap = JSON.parse((await req(port, { path: '/api/snapshot' })).body);
    const sid = snap.planets[0].sessions[0].id;
    const body = JSON.stringify({ kind: 'session', id: sid, text: 'hello', mode: 'plan' });
    const post = h => req(port, { path: '/api/send', method: 'POST', body, headers: h });
    assert.strictEqual((await post({ 'x-gargantua': '1' })).status, 403, 'no cookie');
    assert.strictEqual((await post({ cookie })).status, 403, 'no custom header');
    assert.strictEqual((await post({ cookie, 'x-gargantua': '1', origin: 'http://evil.example' })).status, 403, 'foreign origin');
    const ok = await post({ cookie, 'x-gargantua': '1' });
    assert.strictEqual(JSON.parse(ok.body).ok, true, 'demo transmission accepted');

    assert.notStrictEqual((await req(port, { path: '/../package.json' })).status, 200, 'no path traversal');
    const part = await req(port, { path: '/favicon.svg', headers: { range: 'bytes=0-9' } });
    assert.strictEqual(part.status, 206);
    assert.strictEqual(part.body.length, 10);
  } finally { srv.close(); }
});

(async () => {
  let failed = 0;
  for (const t of tests) {
    try { await t.fn(); console.log('  ✓ ' + t.name); }
    catch (e) { failed++; console.log('  ✗ ' + t.name + '\n    ' + (e.stack || e).toString().split('\n').slice(0, 3).join('\n    ')); }
  }
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(failed ? `\n${failed} failed` : `\n${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
