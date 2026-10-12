'use strict';
// Transmissions: the page sends a prompt to a session or to a repository (a new Claude session there).
// Runs `claude -p` with arguments only — no shell — and keeps a short record of each run.
//   repo             -> claude -p <text> --session-id <new>                      (a new planet)
//   closed session   -> claude -p <text> --resume <id>                           (the same conversation wakes up)
//   open session     -> claude -p <text> --resume <id> --fork-session --session-id <new>
//                       (open in an editor/terminal: writing to its transcript at the same time would tangle it,
//                        so a sibling planet gets the whole context instead)

const fs = require('fs');
const { spawn } = require('child_process');
const crypto = require('crypto');

const MODES = ['plan', 'default', 'acceptEdits', 'auto']; // never bypassPermissions from a web page
const MAX_TEXT = 8000;
const KEEP_MS = 30 * 60000;
const runs = new Map();

function isDir(p) { try { return fs.statSync(p).isDirectory(); } catch { return false; } }
function tailOf(s, n = 3000) { return s.length > n ? s.slice(-n) : s; }

function start({ kind, id, text, mode, cwd, live }) {
  text = String(text || '').replace(/\r/g, '').trim();
  if (!text || text.length > MAX_TEXT) return { ok: false, reason: 'text' };
  if (!MODES.includes(mode)) return { ok: false, reason: 'mode' };
  if (!isDir(cwd)) return { ok: false, reason: 'nodir' };
  const args = ['-p', text, '--permission-mode', mode];
  let session, how;
  if (kind === 'repo') { session = crypto.randomUUID(); how = 'new'; args.push('--session-id', session); }
  else if (live) { session = crypto.randomUUID(); how = 'fork'; args.push('--resume', id, '--fork-session', '--session-id', session); }
  else { session = id; how = 'resume'; args.push('--resume', id); }
  if (process.env.GARGANTUA_MODEL) args.push('--model', process.env.GARGANTUA_MODEL);

  const run = { id: crypto.randomUUID(), kind, target: id, session, how, mode, cwd, prompt: text.slice(0, 300), startedAt: Date.now(), status: 'running', code: null, out: '', err: '' };
  let child;
  try {
    // detached: a run outlives the page and survives Ctrl+C on the server
    child = spawn(process.env.GARGANTUA_CLAUDE || 'claude', args, { cwd, detached: true, stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  } catch (e) { return { ok: false, reason: 'spawn', detail: String(e.message || e) }; }
  run.pid = child.pid;
  child.stdout.on('data', d => { run.out = tailOf(run.out + d); });
  child.stderr.on('data', d => { run.err = tailOf(run.err + d, 1500); });
  child.on('error', e => { run.status = 'failed'; run.err = String(e.message || e); run.endedAt = Date.now(); });
  child.on('exit', code => { run.code = code; run.status = code === 0 ? 'done' : 'failed'; run.endedAt = Date.now(); });
  child.unref();
  runs.set(run.id, run);
  sweep();
  return { ok: true, run: pub(run) };
}

// demo mode: pretend, so the page can be tried without spending anything
function fake({ kind, id, text, mode }) {
  const session = kind === 'repo' ? 'demo-new-' + Date.now() : id;
  const run = { id: crypto.randomUUID(), kind, target: id, session, how: kind === 'repo' ? 'new' : 'resume', mode, cwd: '', prompt: String(text || '').slice(0, 300), startedAt: Date.now(), status: 'running', code: null, out: '', err: '' };
  runs.set(run.id, run);
  setTimeout(() => { run.status = 'done'; run.code = 0; run.endedAt = Date.now(); run.out = 'Transmissão recebida (demo). Nada foi executado.'; }, 6000);
  return { ok: true, run: pub(run) };
}

function sweep() { const now = Date.now(); for (const [k, r] of runs) if (r.endedAt && now - r.endedAt > KEEP_MS) runs.delete(k); }
function pub(r) { const { err, ...rest } = r; return Object.assign(rest, { err: r.status === 'failed' ? r.err : '' }); }
function list() { sweep(); return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt).map(pub); }
function active() { return [...runs.values()].filter(r => r.status === 'running'); }

module.exports = { start, fake, list, active, MODES };
