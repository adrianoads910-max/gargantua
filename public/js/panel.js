'use strict';
// The side panel: what a session is doing, its last prompt and reply, its subagents.

function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// a light, safe markdown: escape first, then code blocks, inline code, bold and headings
function md(s) {
  const blocks = [];
  let h = esc(s).replace(/```[\w-]*\n?([\s\S]*?)```/g, (m, code) => { blocks.push(code); return `\u0000${blocks.length - 1}\u0000`; });
  h = h.replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<strong>$1</strong>')
    .replace(/^#{1,4}\s+(.+)$/gm, '<strong class="h">$1</strong>')
    .replace(/^\s*[-*]\s+/gm, '• ');
  return h.replace(/\u0000(\d+)\u0000/g, (m, i) => `<pre>${blocks[+i]}</pre>`);
}

function ago(ts) {
  if (!ts) return '';
  const s = Math.max(0, (Date.now() - ts) / 1000);
  if (s < 60) return 'agora';
  if (s < 3600) return `há ${Math.floor(s / 60)} min`;
  if (s < 86400) return `há ${Math.floor(s / 3600)} h`;
  return `há ${Math.floor(s / 86400)} d`;
}
const num = n => n >= 1e6 ? (n / 1e6).toFixed(1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(1) + 'k' : String(n || 0);
const model = m => esc(String(m || '').replace(/^claude-/, '').replace(/-\d{8}$/, ''));

function pill(s) {
  const st = STATUS[s.status] || STATUS.idle;
  const what = s.status === 'working' ? (ACTIVITY[s.activity] || st.label) : st.label;
  return `<span class="pill" style="--c:${st.color}"><i></i>${esc(what)}</span>`;
}

const MODES = [
  ['acceptEdits', 'Aceitar edições', 'pode editar arquivos; comandos que pedem permissão são negados'],
  ['plan', 'Só planejar', 'lê e propõe um plano, não altera nada'],
  ['auto', 'Automático', 'o classificador do Claude decide o que é seguro executar'],
  ['default', 'Padrão', 'tudo que pediria permissão é negado (sem ninguém para aprovar)'],
];
const SEND_ERR = {
  text: 'Escreva algo (até 8000 caracteres).', mode: 'Modo inválido.', nodir: 'A pasta não existe mais.',
  gone: 'Esse alvo sumiu da galáxia.', busy: 'Já há uma transmissão em andamento para este planeta.', kind: 'Alvo inválido.',
  spawn: 'Não consegui executar o comando claude.', forbidden: 'Recusado pelo servidor: recarregue a página.',
};
const RUN_LABEL = { running: 'transmitindo…', done: 'concluída', failed: 'falhou' };
const HOW = { new: 'planeta novo', fork: 'planeta-irmão', resume: 'mesma conversa' };

function createPanel(el, { onFocus }) {
  let current = null, timer = null, openSub = new Set(), lastSnap = null, commFor = '';
  el.innerHTML = '<button class="close" aria-label="Fechar">×</button><div class="pbody"></div><div class="comm" hidden></div>';
  const pbody = el.querySelector('.pbody'), comm = el.querySelector('.comm');

  function close() {
    el.classList.remove('open'); current = null; commFor = ''; comm.hidden = true;
    clearInterval(timer); timer = null;
  }

  el.addEventListener('click', e => {
    const b = e.target.closest('[data-focus]');
    if (b) { const i = b.dataset.focus.indexOf('|'); onFocus({ kind: b.dataset.focus.slice(0, i), id: b.dataset.focus.slice(i + 1) }); return; }
    const sub = e.target.closest('[data-sub]');
    if (sub) { const id = sub.dataset.sub; openSub.has(id) ? openSub.delete(id) : openSub.add(id); sub.parentElement.classList.toggle('open'); return; }
    if (e.target.closest('.close')) onFocus(null);
  });

  function frame(kicker, title, body) {
    pbody.innerHTML = `<div class="kicker">${kicker}</div><h2>${title}</h2>${body}`;
    el.classList.add('open');
  }

  // ---- transmission box: built once per planet so the 2-second refresh never wipes what you type ----
  let savedMode = 'acceptEdits';
  try { savedMode = localStorage.getItem('gargantua.mode') || savedMode; } catch {}
  function target() {
    if (!current || current.kind !== 'planet' || !lastSnap) return null;
    for (const p of lastSnap.planets) { const s = p.sessions.find(x => x.id === current.id); if (s) return { id: s.id, s, repoId: p.id, repoName: p.name }; }
    return null;
  }
  function buildComm() {
    const tg = target();
    const key = tg ? tg.id : '';
    if (key === commFor) return updateComm();
    commFor = key;
    comm.hidden = !tg;
    if (!tg) { comm.innerHTML = ''; return; }
    comm.innerHTML = `
      <h3>Canal de transmissão</h3>
      <div class="cwhere" role="radiogroup">
        <label><input type="radio" name="cwhere" value="session" checked> Nesta sessão</label>
        <label><input type="radio" name="cwhere" value="repo"> Nova sessão em <b>${esc(tg.repoName)}</b></label>
      </div>
      <p class="muted cinfo"></p>
      <textarea class="ctext" rows="3" maxlength="8000" placeholder="Mensagem para este planeta…"></textarea>
      <div class="crow">
        <select class="cmode" title="Permissões da execução">${MODES.map(([v, l, d]) => `<option value="${v}" title="${esc(d)}" ${v === savedMode ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
        <button class="csend">Transmitir <kbd>Ctrl ⏎</kbd></button>
      </div>
      <div class="cmsg" hidden></div>
      <div class="clog"></div>`;
    updateComm();
  }
  const where = () => { const r = comm.querySelector('input[name="cwhere"]:checked'); return r ? r.value : 'session'; };
  function updateComm() {
    const tg = target();
    if (!tg) return;
    const info = comm.querySelector('.cinfo'), btn = comm.querySelector('.csend');
    const running = (lastSnap.runs || []).some(r => r.status === 'running' && r.session === tg.id);
    const w = where();
    let txt;
    if (w === 'repo') txt = `Abre uma sessão nova do Claude em <code>${esc(tg.repoName)}</code> (<code>claude -p</code>). Ela surge como um planeta novo.`;
    else if (tg.s.viaShip || running) txt = 'Uma transmissão sua ainda está em andamento neste planeta. Espere ela terminar.';
    else if (tg.s.live) txt = 'Esta sessão está aberta em outro lugar (VS Code ou terminal). Para não embaralhar a conversa, a transmissão cria um <b>planeta-irmão</b> com todo o contexto dela.';
    else txt = 'Esta sessão está fechada: a transmissão retoma a mesma conversa (<code>--resume</code>) e o planeta volta para a órbita.';
    info.innerHTML = txt;
    btn.disabled = w === 'session' && (tg.s.viaShip || running);
    const mine = (lastSnap.runs || []).filter(r => r.target === tg.id || r.session === tg.id || (w === 'repo' && r.target === tg.repoId)).slice(0, 4);
    comm.querySelector('.clog').innerHTML = mine.map(r => `
      <div class="run ${r.status}">
        <div class="rhead"><i></i><b>${RUN_LABEL[r.status] || esc(r.status)}</b><span>${esc(HOW[r.how] || '')} · ${esc(r.mode)} · ${ago(r.startedAt)}</span>
          ${r.session !== tg.id ? `<a data-focus="planet|${esc(r.session)}">ver planeta →</a>` : ''}</div>
        <div class="rprompt">${esc(r.prompt)}</div>
        ${r.out ? `<div class="box">${md(r.out)}</div>` : ''}
        ${r.err ? `<div class="box err">${esc(r.err)}</div>` : ''}
      </div>`).join('');
  }
  async function sendComm() {
    const tg = target();
    const ta = comm.querySelector('.ctext'), mode = comm.querySelector('.cmode').value, msg = comm.querySelector('.cmsg'), btn = comm.querySelector('.csend');
    if (!tg || !ta.value.trim() || btn.disabled) return;
    const w = where();
    btn.disabled = true;
    let out;
    try {
      const r = await fetch('/api/send', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Gargantua': '1' }, body: JSON.stringify({ kind: w, id: w === 'repo' ? tg.repoId : tg.id, text: ta.value, mode }) });
      out = r.status === 403 ? { ok: false, reason: 'forbidden' } : await r.json();
    } catch { out = { ok: false, reason: 'spawn' }; }
    btn.disabled = false;
    msg.hidden = false;
    msg.className = 'cmsg ' + (out.ok ? 'ok' : 'bad');
    msg.textContent = out.ok ? (out.run.how === 'resume' ? 'Transmitido. O planeta voltou à vida.' : `Transmitido. Um ${HOW[out.run.how]} está surgindo.`) : (SEND_ERR[out.reason] || 'Falhou: ' + (out.reason || '?')) + (out.detail ? ' ' + out.detail : '');
    if (out.ok) {
      ta.value = '';
      lastSnap.runs = [out.run].concat(lastSnap.runs || []);
      updateComm();
    }
  }
  comm.addEventListener('keydown', e => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); sendComm(); } });
  comm.addEventListener('change', e => {
    if (e.target.classList.contains('cmode')) { savedMode = e.target.value; try { localStorage.setItem('gargantua.mode', savedMode); } catch {} }
    if (e.target.name === 'cwhere') updateComm();
  });
  comm.addEventListener('click', e => { if (e.target.closest('.csend')) sendComm(); });

  async function fetchSession(id) {
    try { const r = await fetch('/api/session/' + encodeURIComponent(id)); return r.ok ? await r.json() : null; } catch { return null; }
  }

  // a planet = a session
  async function loadPlanet(id) {
    const d = await fetchSession(id);
    if (!current || current.kind !== 'planet' || current.id !== id) return;
    if (!d) { frame('Planeta', 'Sessão encerrada', '<p class="muted">Esta sessão não está mais no disco.</p>'); return; }
    const pl = galaxyRef && galaxyRef.planets.get(id);
    const falling = pl && pl.fall > 0.02;
    const tools = (d.tools || []).slice().reverse().map(t => `<li class="${t.pending ? 'live' : ''}"><b>${esc(t.name)}</b> ${esc(t.what)}<span>${ago(t.ts)}</span></li>`).join('');
    const moons = (d.subagents || []).map(a => `<button class="row" data-focus="moon|${esc(d.id + ':' + a.id)}"><span class="pill" style="--c:${a.active ? STATUS.working.color : STATUS.dormant.color}"><i></i>${a.active ? esc(ACTIVITY[a.activity] || 'ativo') : 'concluído'}</span><b>${esc(a.type)}</b><small>${esc(a.description || '')}</small></button>`).join('');
    frame(`${esc(pl ? pl.world.label : 'Planeta')} · ${esc(d.planetName)}`, esc(d.title), `
      <div class="meta">${pill(d)}${d.model ? `<span>${model(d.model)}</span>` : ''}${d.branch ? `<span>⎇ ${esc(d.branch)}</span>` : ''}<span>${d.turns} turnos</span><span>${num(d.tokensOut)} tokens</span></div>
      ${falling ? `<div class="doing falling">↘ parada há ${ago(d.lastTs).replace('há ', '')}: caindo no Gargantua (${Math.round(pl.fall * 100)}%)</div>` : ''}
      ${d.doing ? `<div class="doing">${d.status === 'ask' ? '⚠ ' : '▸ '}${esc(d.doing)}</div>` : ''}
      <h3>Último prompt <span>${ago(d.lastPromptAt)}</span></h3>
      <div class="box prompt">${md(d.lastPrompt || '—')}</div>
      <h3>Resposta <span>${d.status === 'working' ? 'em andamento' : ago(d.lastReplyAt)}</span></h3>
      <div class="box reply">${md(d.reply || (d.status === 'working' ? 'pensando…' : '—'))}</div>
      ${moons ? `<h3>Luas · subagentes</h3><div class="rows">${moons}</div>` : ''}
      ${tools ? `<h3>Ferramentas recentes</h3><ul class="tools">${tools}</ul>` : ''}
      <div class="path">${esc(d.cwd)}</div>`);
  }

  // a moon = a subagent of that session
  async function loadMoon(key) {
    const [sid, aid] = key.split(':');
    const d = await fetchSession(sid);
    if (!current || current.kind !== 'moon' || current.id !== key) return;
    const a = d && (d.subagents || []).find(x => x.id === aid);
    if (!a) { frame('Lua', 'Subagente encerrado', '<p class="muted">Este subagente já não aparece no disco.</p>'); return; }
    const tools = (a.tools || []).slice().reverse().map(t => `<li><b>${esc(t.name)}</b> ${esc(t.what)}<span>${ago(t.ts)}</span></li>`).join('');
    frame(`Lua de <a data-focus="planet|${esc(sid)}">${esc(d.title)}</a>`, esc(a.type), `
      <div class="meta"><span class="pill" style="--c:${a.active ? STATUS.working.color : STATUS.dormant.color}"><i></i>${a.active ? esc(ACTIVITY[a.activity] || 'ativo') : 'concluído'}</span>${a.description ? `<span>${esc(a.description)}</span>` : ''}</div>
      ${a.doing ? `<div class="doing">▸ ${esc(a.doing)}</div>` : ''}
      <h3>Tarefa</h3><div class="box prompt">${md(a.prompt || '—')}</div>
      <h3>Resposta</h3><div class="box reply">${md(a.reply || (a.active ? 'trabalhando…' : '—'))}</div>
      ${tools ? `<h3>Ferramentas recentes</h3><ul class="tools">${tools}</ul>` : ''}`);
  }

  function renderShip(snap) {
    const all = snap.planets.flatMap(p => p.sessions.map(s => Object.assign({ repo: p.name }, s)));
    const waiting = all.filter(s => s.status === 'ask');
    const yours = all.filter(s => s.status === 'idle').sort((a, b) => b.lastTs - a.lastTs);
    const here = snap.you && all.find(s => s.id === snap.you.session);
    const row = s => `<button class="row" data-focus="planet|${esc(s.id)}">${pill(s)}<b>${esc(s.title)}</b><small>${esc(s.repo)} · ${ago(s.lastTs)}</small></button>`;
    frame('Nave', 'Você', `
      <p class="muted">No piloto automático a nave vai até o planeta que está chamando você; sem chamados, fica onde você mandou o último prompt. Pilote com <kbd>W A S D</kbd> e cuidado com o horizonte de eventos.</p>
      ${here ? `<h3>Em órbita de</h3><div class="rows">${row(here)}</div>` : ''}
      ${waiting.length ? `<h3>Chamando você</h3><div class="rows">${waiting.map(row).join('')}</div>` : ''}
      ${yours.length ? `<h3>Esperando seu próximo prompt</h3><div class="rows">${yours.map(row).join('')}</div>` : ''}`);
  }

  let galaxyRef = null;
  function show(focus, snap, galaxy) {
    const same = current && focus && current.kind === focus.kind && current.id === focus.id;
    current = focus;
    if (snap) lastSnap = snap;
    if (galaxy) galaxyRef = galaxy;
    clearInterval(timer); timer = null;
    if (!focus || !snap) return close();
    if (!same) openSub = new Set();
    buildComm();
    const load = focus.kind === 'planet' ? loadPlanet : focus.kind === 'moon' ? loadMoon : null;
    if (load) {
      if (!same) frame('…', '…', '<p class="muted">sintonizando…</p>');
      load(focus.id);
      timer = setInterval(() => load(focus.id), 2000);
    } else refresh(snap, galaxy);
  }

  function refresh(snap, galaxy) {
    if (snap) lastSnap = snap;
    if (galaxy) galaxyRef = galaxy;
    if (!current || !snap) return;
    buildComm();
    if (current.kind === 'ship') renderShip(snap);
  }

  function focusComm() { setTimeout(() => { const ta = comm.querySelector('.ctext'); if (ta) ta.focus(); }, 60); }

  return { show, refresh, close, focusComm };
}
