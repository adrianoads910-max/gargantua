'use strict';
// Builds the galaxy from what Claude Code already keeps on disk:
//   ~/.claude/sessions/<pid>.json   live-session registry (the *.key files next to it are never read)
//   ~/.claude/projects/**/<id>.jsonl conversation transcripts
//   <id>/subagents/agent-*.jsonl     subagent transcripts (+ .meta.json with type and description)
// Repositories become planets, sessions become moons, subagents become rings.

const fs = require('fs');
const os = require('os');
const path = require('path');
const { read, newestPending, short } = require('./transcript');

const DIR = () => process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), '.claude');
const RECENT_MS = Number(process.env.GARGANTUA_RECENT_HOURS || 3) * 3600 * 1000;
const SCAN_EVERY_MS = 15000;
const SUBAGENT_ACTIVE_MS = 45000;
const SUBAGENT_KEEP_MS = 10 * 60000;
const PERMISSION_WAIT_MS = 6000;

function safeJson(file) { try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; } }
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }

const repoCache = new Map();
function repoOf(dir) {
  if (!dir) return { root: '?', name: '?' };
  const hit = repoCache.get(dir);
  if (hit && Date.now() - hit.at < 60000) return hit.v;
  let v = null, cur = dir;
  for (let i = 0; i < 40; i++) {
    let st = null;
    try { st = fs.statSync(path.join(cur, '.git')); } catch {}
    if (st) {
      let root = cur;
      if (st.isFile()) { // worktree: the planet is the main repository
        try {
          const m = /gitdir:\s*(.+)/.exec(fs.readFileSync(path.join(cur, '.git'), 'utf8'));
          const gitdir = m && path.resolve(cur, m[1].trim());
          const common = gitdir && path.resolve(gitdir, fs.readFileSync(path.join(gitdir, 'commondir'), 'utf8').trim());
          if (common && path.basename(common) === '.git') root = path.dirname(common);
        } catch {}
      }
      v = { root, name: path.basename(root) };
      break;
    }
    const up = path.dirname(cur);
    if (up === cur) break;
    cur = up;
  }
  if (!v) v = { root: dir, name: path.basename(dir) || dir };
  repoCache.set(dir, { at: Date.now(), v });
  return v;
}

// --- where each transcript lives -------------------------------------------------------------
let scanAt = 0, recentFiles = new Map(); // sessionId -> file
const byId = new Map();
function scan(now) {
  if (now - scanAt < SCAN_EVERY_MS) return;
  scanAt = now;
  const root = path.join(DIR(), 'projects');
  const found = new Map();
  let dirs = [];
  try { dirs = fs.readdirSync(root); } catch {}
  for (const d of dirs) {
    let files = [];
    try { files = fs.readdirSync(path.join(root, d)); } catch { continue; }
    for (const f of files) {
      if (!f.endsWith('.jsonl')) continue;
      const full = path.join(root, d, f), id = f.slice(0, -6);
      byId.set(id, full);
      let mt = 0;
      try { mt = fs.statSync(full).mtimeMs; } catch { continue; }
      if (now - mt < RECENT_MS) found.set(id, full);
    }
  }
  recentFiles = found;
}
let missAt = 0;
function transcriptOf(id) {
  const hit = byId.get(id);
  if (hit && fs.existsSync(hit)) return hit;
  const now = Date.now();
  if (now - missAt > 2000) { missAt = now; scanAt = 0; scan(now); } // a new transcript: rescan, but not every call
  return byId.get(id) || null;
}

function registry() {
  const dir = path.join(DIR(), 'sessions'), out = new Map();
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => /^\d+\.json$/.test(f)); } catch { return out; }
  for (const f of files) {
    const s = safeJson(path.join(dir, f));
    if (s && s.sessionId && alive(s.pid)) out.set(s.sessionId, s);
  }
  return out;
}

function subagents(transcript, now, full) {
  const dir = path.join(path.dirname(transcript), path.basename(transcript, '.jsonl'), 'subagents');
  let files = [];
  try { files = fs.readdirSync(dir).filter(f => f.endsWith('.jsonl')); } catch { return []; }
  const out = [];
  for (const f of files) {
    const p = path.join(dir, f);
    let mt = 0;
    try { mt = fs.statSync(p).mtimeMs; } catch { continue; }
    if (now - mt > SUBAGENT_KEEP_MS) continue;
    const st = read(p);
    if (!st) continue;
    if (!st.agentType) {
      const meta = safeJson(p.replace(/\.jsonl$/, '.meta.json')) || {};
      st.agentType = meta.agentType || 'agent'; st.description = meta.description || '';
    }
    const pend = newestPending(st);
    const a = {
      id: f.replace(/^agent-|\.jsonl$/g, ''), type: st.agentType, description: short(st.description, 80),
      active: now - mt < SUBAGENT_ACTIVE_MS, activity: pend ? pend.kind : 'thinking', doing: pend ? pend.what : '', at: mt,
    };
    if (full) Object.assign(a, { prompt: st.firstPrompt, reply: st.reply, tools: st.recent.slice(-5).map(t => ({ name: t.name, what: t.what, ts: t.ts })) });
    out.push(a);
  }
  return out.sort((a, b) => b.at - a.at).slice(0, 8);
}

function statusOf(reg, st, now) {
  if (!reg) return 'dormant';
  if (!st) return reg.status === 'busy' ? 'working' : 'idle';
  const pend = newestPending(st);
  if (pend && pend.kind === 'ask') return 'ask';
  // a tool pending for a while in a session the registry calls idle = a permission prompt waiting for you
  if (pend && reg.status !== 'busy' && now - pend.ts > PERMISSION_WAIT_MS) return 'ask';
  if (reg.status === 'busy') return 'working';
  if (st.turnOpen && now - st.mtime < 15000) return 'working';
  if (reg.status && !['busy', 'idle'].includes(reg.status)) return 'ask';
  return 'idle';
}

function sessionOf(id, reg, file, now, full) {
  const st = file ? read(file) : null;
  const cwd = (reg && reg.cwd) || (st && st.cwd) || '';
  if (!cwd) return null;
  const repo = repoOf(cwd);
  const status = statusOf(reg, st, now);
  const pend = st && newestPending(st);
  const s = {
    id, planet: repo.root, planetName: repo.name, cwd,
    title: (st && st.title) || (reg && reg.name) || short(st && st.firstPrompt, 48) || id.slice(0, 8),
    status, activity: status === 'working' ? (pend ? pend.kind : 'thinking') : status,
    doing: pend ? (pend.name + (pend.what ? ' · ' + pend.what : '')) : '',
    model: (st && st.model) || '', branch: (st && st.branch) || '',
    entrypoint: (reg && reg.entrypoint) || '', viaShip: !!(reg && reg.viaShip),
    live: !!(reg && !reg.viaShip),
    lastTs: Math.max(st ? st.lastTs : 0, reg ? (reg.statusUpdatedAt || reg.updatedAt || 0) : 0),
    lastPromptAt: st ? st.lastPromptAt : 0,
    prompt: st ? short(st.lastPrompt, 160) : '',
    turns: st ? st.turns : 0, tokensOut: st ? st.tokensOut : 0, ctx: st ? st.ctx : 0,
    subagents: file ? subagents(file, now, full) : [],
  };
  if (full) Object.assign(s, {
    lastPrompt: st ? st.lastPrompt : '', reply: st ? st.reply : '', lastReplyAt: st ? st.lastReplyAt : 0,
    tools: st ? st.recent.slice(-6).map(t => ({ name: t.name, what: t.what, kind: t.kind, ts: t.ts, pending: st.pending.has(t.id) })) : [],
  });
  return s;
}

// runs = transmissions started from the page that are still running: their moon is awake even before
// the registry or the transcript says so
function withRuns(reg, runs) {
  for (const r of runs || []) {
    const cur = reg.get(r.session);
    reg.set(r.session, Object.assign({ cwd: r.cwd, name: 'Endurance · ' + short(r.prompt, 40) }, cur, { status: 'busy', viaShip: true }));
  }
  return reg;
}

function snapshot(runs) {
  const now = Date.now();
  scan(now);
  const reg = withRuns(registry(), runs);
  const ids = new Set([...reg.keys(), ...recentFiles.keys()]);
  const sessions = [];
  for (const id of ids) {
    const s = sessionOf(id, reg.get(id), recentFiles.get(id) || transcriptOf(id), now, false);
    if (s) sessions.push(s);
  }
  return build(sessions, now);
}

function build(sessions, now) {
  const planets = new Map();
  for (const s of sessions) {
    if (!planets.has(s.planet)) planets.set(s.planet, { id: s.planet, name: s.planetName, sessions: [] });
    planets.get(s.planet).sessions.push(s);
  }
  const list = [...planets.values()];
  for (const p of list) p.sessions.sort((a, b) => a.id.localeCompare(b.id));
  list.sort((a, b) => a.id.localeCompare(b.id)); // stable orbits: a planet keeps its place
  const count = st => sessions.filter(s => s.status === st).length;
  const models = {};
  for (const s of sessions) if (s.model && s.status !== 'dormant') models[s.model] = (models[s.model] || 0) + 1;
  // you are wherever a session waits for you; otherwise where you last spoke
  const live = sessions.filter(s => s.status !== 'dormant');
  const asking = live.filter(s => s.status === 'ask').sort((a, b) => b.lastTs - a.lastTs)[0];
  const last = (live.length ? live : sessions).slice().sort((a, b) => b.lastPromptAt - a.lastPromptAt)[0];
  const you = asking || last;
  return {
    now, planets: list,
    claude: {
      working: count('working'), ask: count('ask'), idle: count('idle'), dormant: count('dormant'),
      subagents: sessions.reduce((n, s) => n + s.subagents.filter(a => a.active).length, 0),
      tokensOut: sessions.reduce((n, s) => n + s.tokensOut, 0), models,
    },
    you: you ? { session: you.id, at: you.lastPromptAt, waiting: !!asking } : null,
  };
}

function details(id, runs) {
  const now = Date.now();
  const reg = withRuns(registry(), runs);
  const file = transcriptOf(id);
  if (!file && !reg.has(id)) return null;
  return sessionOf(id, reg.get(id), file, now, true);
}

module.exports = { snapshot, details, build, statusOf, repoOf, registry };
