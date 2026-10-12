'use strict';
// Reads Claude Code transcripts (~/.claude/projects/**/<session>.jsonl) incrementally:
// only the bytes appended since the last read are parsed, and each file keeps a small state.

const fs = require('fs');
const path = require('path');

const FIRST_READ_MAX = 8 * 1024 * 1024; // a huge transcript is read from its tail
const PROMPT_MAX = 4000;
const REPLY_MAX = 8000;
const STATE_IDLE_MS = 6 * 3600 * 1000;

// commands and prompts may carry secrets (TOKEN=..., --password x, Bearer ...): mask them
const SECRET = /((?:token|secret|passw(?:or)?d|api[_-]?key|bearer|credential)[\w-]*\s*[=:]\s*)("[^"]*"|'[^']*'|\S+)/gi;
function mask(s) {
  return String(s || '').replace(/(bearer\s+)[\w.\-~+/=]{8,}/gi, '$1•••').replace(SECRET, (m, k) => k + '•••');
}
function short(s, n = 60) {
  s = mask(s).replace(/\s+/g, ' ').trim();
  return s.length > n ? s.slice(0, n - 1) + '…' : s;
}
function tail(s, n) { s = mask(s).trim(); return s.length > n ? '…' + s.slice(-n) : s; }
function head(s, n) { s = mask(s).trim(); return s.length > n ? s.slice(0, n) + '…' : s; }

const ACTIVITY = {
  Edit: 'edit', Write: 'edit', NotebookEdit: 'edit', MultiEdit: 'edit',
  Read: 'read', Grep: 'read', Glob: 'read', LS: 'read', ToolSearch: 'read',
  Bash: 'terminal', Monitor: 'terminal', BashOutput: 'terminal',
  WebFetch: 'web', WebSearch: 'web',
  Agent: 'delegate', Task: 'delegate', Workflow: 'delegate', SendMessage: 'delegate',
  Skill: 'skill', AskUserQuestion: 'ask', ExitPlanMode: 'ask',
};
function activityOf(name) {
  if (ACTIVITY[name]) return ACTIVITY[name];
  if (name.startsWith('mcp__')) return 'mcp';
  return 'other';
}

function summarize(name, input) {
  input = input || {};
  if (input.file_path) return path.basename(input.file_path);
  if (input.notebook_path) return path.basename(input.notebook_path);
  if (name === 'Bash') return short(input.description || input.command);
  if (name === 'Grep' || name === 'Glob') return short(input.pattern);
  if (name === 'WebFetch') { try { return new URL(input.url).hostname; } catch { return ''; } }
  if (name === 'WebSearch') return short(input.query);
  if (name === 'Skill') return short(input.skill);
  if (name === 'Agent' || name === 'Task') return short(input.description);
  if (name === 'AskUserQuestion') return short(((input.questions || [])[0] || {}).question, 140);
  if (name.startsWith('mcp__')) return name.split('__').slice(2).join('__');
  return '';
}

function textOf(content) {
  if (typeof content === 'string') return content;
  if (!Array.isArray(content)) return '';
  return content.filter(c => c && c.type === 'text' && c.text).map(c => c.text).join('\n');
}
const isToolResult = c => Array.isArray(c) && c.length > 0 && c.every(x => x && x.type === 'tool_result');
// injected text (command wrappers, reminders, interruptions) is not something the user typed
const isNoise = t => !t || /^\s*</.test(t) || /^\[Request interrupted/.test(t) || /^Caveat:/.test(t);

function newState() {
  return {
    offset: 0, partial: '', mtime: 0, seen: 0,
    cwd: '', branch: '', title: '', model: '', lastTs: 0,
    lastPrompt: '', lastPromptAt: 0, firstPrompt: '',
    reply: '', lastReplyAt: 0,
    pending: new Map(), recent: [], turnOpen: false, turns: 0,
    tokensOut: 0, ctx: 0, lastMsgId: '',
    agentType: '', description: '',
  };
}

function absorb(st, d) {
  const ts = d.timestamp ? Date.parse(d.timestamp) : 0;
  if (ts) st.lastTs = Math.max(st.lastTs, ts);
  if (d.cwd) st.cwd = d.cwd;
  if (d.gitBranch) st.branch = d.gitBranch;
  if (d.type === 'ai-title' && d.aiTitle) st.title = short(d.aiTitle, 80);
  if (d.type === 'system' && d.subtype === 'turn_duration') { st.pending.clear(); st.turnOpen = false; }
  const m = d.message;
  if (d.type === 'user' && m && !d.isMeta && !isToolResult(m.content)) {
    const text = textOf(m.content);
    if (d.isCompactSummary) { st.reply = ''; }
    else if (!isNoise(text)) {
      st.lastPrompt = head(text, PROMPT_MAX); st.lastPromptAt = ts || st.lastPromptAt;
      if (!st.firstPrompt) st.firstPrompt = head(text, PROMPT_MAX);
      st.reply = ''; st.turns++; st.turnOpen = true; st.pending.clear();
    }
  }
  if (!m) return;
  if (d.type === 'assistant') {
    st.turnOpen = true;
    if (m.model && !m.model.startsWith('<')) st.model = m.model;
    const u = m.usage;
    if (u && (!m.id || m.id !== st.lastMsgId)) { // one API message is split in several entries with the same usage
      st.lastMsgId = m.id;
      st.tokensOut += u.output_tokens || 0;
      st.ctx = (u.input_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
    }
    for (const c of Array.isArray(m.content) ? m.content : []) {
      if (c.type === 'text' && c.text && c.text.trim()) {
        st.reply = tail((st.reply ? st.reply + '\n\n' : '') + c.text.trim(), REPLY_MAX);
        st.lastReplyAt = ts;
      }
      if (c.type !== 'tool_use') continue;
      const name = c.name || '?';
      const item = { id: c.id, name, kind: activityOf(name), what: summarize(name, c.input), ts: ts || Date.now() };
      st.pending.set(c.id, item);
      st.recent.push(item); if (st.recent.length > 8) st.recent.shift();
    }
  } else if (d.type === 'user' && Array.isArray(m.content)) {
    for (const c of m.content) {
      if (c && c.type === 'tool_result') st.pending.delete(c.tool_use_id);
      if (c && c.type === 'text' && /^\[Request interrupted/.test(c.text || '')) { st.pending.clear(); st.turnOpen = false; }
    }
  } else if (d.type === 'user' && typeof m.content === 'string' && /^\[Request interrupted/.test(m.content)) {
    st.pending.clear(); st.turnOpen = false;
  }
}

const states = new Map();
let lastSweep = Date.now();

function read(file) {
  const now = Date.now();
  if (now - lastSweep > 600000) { lastSweep = now; for (const [f, s] of states) if (now - s.seen > STATE_IDLE_MS) states.delete(f); }
  let stat;
  try { stat = fs.statSync(file); } catch { return null; }
  let st = states.get(file);
  if (!st || stat.size < st.offset) { st = newState(); states.set(file, st); }
  st.mtime = stat.mtimeMs; st.seen = now;
  if (stat.size === st.offset) return st;
  let start = st.offset, skipFirst = false;
  if (stat.size - start > FIRST_READ_MAX) { start = stat.size - FIRST_READ_MAX; st.partial = ''; skipFirst = true; }
  let buf;
  const fd = fs.openSync(file, 'r');
  try {
    buf = Buffer.alloc(stat.size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
  } finally { fs.closeSync(fd); }
  st.offset = stat.size;
  const lines = (st.partial + buf.toString('utf8')).split('\n');
  st.partial = lines.pop();
  if (st.partial.length > 1024 * 1024) st.partial = '';
  if (skipFirst) lines.shift();
  for (const line of lines) {
    if (!line) continue;
    let d;
    try { d = JSON.parse(line); } catch { continue; }
    try { absorb(st, d); } catch {}
  }
  return st;
}

function newestPending(st) {
  let best = null;
  for (const p of st.pending.values()) if (!best || p.ts >= best.ts) best = p;
  return best;
}

module.exports = { read, newestPending, short, mask, absorb, newState };
