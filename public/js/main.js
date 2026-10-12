'use strict';
// Wires it together: data stream, camera, input, the render layers, the hangar and the HUD.

(function () {
  const skyCanvas = document.getElementById('sky'), bhCanvas = document.getElementById('bh');
  const fx = document.getElementById('fx'), ctx = fx.getContext('2d');
  const fxb = document.getElementById('fxb'), ctxb = fxb.getContext('2d');
  const tip = document.getElementById('tip'), toastEl = document.getElementById('toast');
  const params = new URLSearchParams(location.search);
  const store = { get: k => { try { return localStorage.getItem(k); } catch { return null; } }, set: (k, v) => { try { localStorage.setItem(k, v); } catch {} } };

  const cam = createCamera();
  const galaxy = createGalaxy({ fallMinutes: Number(params.get('fall')) || 0 }); // ?fall=10: the whole fall in 10 min
  let bh = null;
  try { bh = createBlackHole(bhCanvas, skyCanvas); } catch (e) { console.error(e); }
  if (!bh) document.body.classList.add('no-webgl');

  let toastTimer = null;
  function toast(text, ms = 5000) {
    toastEl.textContent = text; toastEl.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(() => { toastEl.hidden = true; }, ms);
  }

  const ui = {
    focus: null, hover: null, dt: 0.016, pilot: false, thrust: [0, 0, 0], near: null,
    shipKind: SHIPS.some(s => s.id === store.get('gargantua.ship')) ? store.get('gargantua.ship') : 'endurance',
    onCaptured: () => toast('Horizonte de eventos. Não há volta: o tempo aqui fora quase para.'),
    onSwallowed: () => toast('A nave sumiu no Gargantua…', 3000),
    onRespawn: () => { setPilot(false); toast('…e voltou pelo tesseract, na borda da galáxia.'); },
  };
  const panel = createPanel(document.getElementById('panel'), { onFocus: setFocus });
  const HOME_DIST = () => Math.max(90, outerOrbit(galaxy.planets.size) * 2.45);

  function setFocus(f) {
    ui.focus = f;
    if (!f) { cam.want.target = [0, 0, 0]; cam.want.dist = HOME_DIST(); }
    panel.show(f, galaxy.snap, galaxy);
  }

  // ---- hangar: which ship you fly ----
  const shipsEl = document.getElementById('ships');
  function renderHangar() {
    shipsEl.innerHTML = SHIPS.map(s => `<button class="shipopt ${s.id === ui.shipKind ? 'on' : ''}" data-ship="${s.id}" aria-pressed="${s.id === ui.shipKind}"><canvas width="88" height="56" data-preview="${s.id}"></canvas><b>${esc(s.label)}</b><small>${esc(s.note)}</small></button>`).join('');
  }
  shipsEl.addEventListener('click', e => {
    const b = e.target.closest('[data-ship]');
    if (!b) return;
    ui.shipKind = b.dataset.ship; store.set('gargantua.ship', ui.shipKind);
    renderHangar();
  });
  renderHangar();
  function drawPreviews(t) {
    for (const c of shipsEl.querySelectorAll('canvas[data-preview]')) {
      const x = c.getContext('2d');
      x.clearRect(0, 0, c.width, c.height);
      x.save(); x.translate(c.width / 2, c.height / 2);
      drawShip(c.dataset.preview, x, 17, t, { a: -Math.PI / 4, s: 0.5 });
      x.restore();
    }
  }

  const typing = e => e.target.closest && e.target.closest('input:not([type=range]), textarea, select, [contenteditable]');

  // ---- soundtrack: starts on the first click or key (browsers block autoplay), fades in, volume remembered ----
  const music = document.getElementById('music'), vol = document.getElementById('vol'), mute = document.getElementById('mute'), volHint = document.getElementById('vol-hint');
  let level = Number(store.get('gargantua.volume') ?? 35), muted = store.get('gargantua.muted') === '1', started = false, fadeTimer = null;
  if (!(level >= 0 && level <= 100)) level = 35;
  vol.value = level;
  const target = () => (muted ? 0 : level / 100) ** 2; // perceptual curve: the slider feels even
  function applySound() {
    mute.classList.toggle('off', muted || level === 0);
    vol.style.opacity = muted ? 0.45 : 1;
    if (!started) return;
    clearInterval(fadeTimer);
    music.volume = target();
    if (target() > 0 && music.paused) music.play().catch(() => {});
    if (target() === 0 && !music.paused) music.pause();
  }
  function startMusic() {
    if (started || target() === 0) return;
    started = true; volHint.hidden = true;
    music.volume = 0;
    music.play().then(() => { // a slow fade-in, like a ship coming out of the dark
      clearInterval(fadeTimer);
      fadeTimer = setInterval(() => { music.volume = Math.min(target(), music.volume + target() / 40); if (music.volume >= target()) clearInterval(fadeTimer); }, 60);
    }).catch(() => { started = false; volHint.hidden = false; });
  }
  vol.addEventListener('input', () => { level = Number(vol.value); muted = false; store.set('gargantua.volume', level); store.set('gargantua.muted', '0'); if (!started) startMusic(); applySound(); });
  mute.addEventListener('click', () => { muted = !muted; store.set('gargantua.muted', muted ? '1' : '0'); if (!muted && !started) startMusic(); applySound(); });
  addEventListener('pointerdown', startMusic, { once: false, capture: true });
  addEventListener('keydown', e => { if (e.key.toLowerCase() === 'm' && !typing(e)) mute.click(); else startMusic(); }, { capture: true });
  if (muted || level === 0) volHint.hidden = true;
  applySound();

  // ---- data ----
  let first = true;
  function onSnap(s) {
    if (s.error) { console.warn(s.error); return; }
    galaxy.update(s);
    if (first) { first = false; cam.want.dist = cam.dist = HOME_DIST(); }
    hud(s);
    panel.refresh(s, galaxy);
  }
  function connect() {
    const es = new EventSource('/events');
    es.onmessage = e => { try { onSnap(JSON.parse(e.data)); } catch (err) { console.error(err); } };
    es.onerror = () => { es.close(); setTimeout(connect, 2000); };
  }
  connect();

  const set = (id, v) => { const e = document.getElementById(id); if (e && e.textContent !== String(v)) e.textContent = v; };
  function hud(s) {
    const c = s.claude;
    set('n-working', c.working);
    set('n-ask', c.ask);
    set('n-idle', c.idle);
    document.getElementById('c-ask').classList.toggle('hot', c.ask > 0);
    document.title = (c.ask ? `(${c.ask}) ` : '') + 'Gargantua';
    document.getElementById('demo').hidden = !s.demo;
    document.getElementById('empty').hidden = s.planets.length > 0;
  }

  // ---- sizing & adaptive resolution for the ray marcher ----
  let quality = Number(params.get('q')) || 0.6, frameMs = 16;
  function resize() {
    const w = innerWidth, h = innerHeight, dpr = Math.min(devicePixelRatio || 1, 2);
    for (const [c, x] of [[fx, ctx], [fxb, ctxb]]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); x.setTransform(dpr, 0, 0, dpr, 0, 0); }
    for (const c of [bhCanvas, skyCanvas]) { c.width = Math.max(64, Math.round(w * quality)); c.height = Math.max(64, Math.round(h * quality)); }
    cam.W = w; cam.H = h;
  }
  addEventListener('resize', resize);
  resize();

  // ---- input ----
  let drag = null, lastInput = performance.now();
  const hitAt = (x, y) => {
    let best = null;
    for (const h of hits) if (Math.hypot(h.x - x, h.y - y) <= h.r && (!best || h.z < best.z)) best = h;
    return best;
  };
  fx.addEventListener('pointerdown', e => { drag = { x: e.clientX, y: e.clientY, moved: 0 }; fx.setPointerCapture(e.pointerId); lastInput = performance.now(); });
  fx.addEventListener('pointermove', e => {
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
      drag.moved += Math.abs(dx) + Math.abs(dy); drag.x = e.clientX; drag.y = e.clientY;
      cam.yaw -= dx * 0.005;
      cam.pitch = Math.max(0.02, Math.min(1.35, cam.pitch + dy * 0.004));
      lastInput = performance.now();
      fx.classList.add('dragging');
    }
    const h = hitAt(e.clientX, e.clientY);
    ui.hover = h;
    fx.style.cursor = drag && drag.moved > 4 ? 'grabbing' : h ? 'pointer' : 'grab';
    showTip(h, e.clientX, e.clientY);
  });
  fx.addEventListener('pointerup', e => {
    fx.classList.remove('dragging');
    if (drag && drag.moved < 5) {
      const h = hitAt(e.clientX, e.clientY);
      if (h) setFocus({ kind: h.kind, id: h.id });
      else if (ui.pilot) { ui.focus = { kind: 'ship', id: 'ship' }; panel.show(null); } // empty space while piloting: stay with the ship
      else setFocus(null);
    }
    drag = null;
  });
  fx.addEventListener('pointerleave', () => { ui.hover = null; tip.hidden = true; });
  fx.addEventListener('wheel', e => {
    e.preventDefault();
    cam.want.dist = Math.max(4, Math.min(400, cam.want.dist * Math.exp(e.deltaY * 0.0012)));
    lastInput = performance.now();
  }, { passive: false });

  // ---- piloting: WASD / arrows move the ship relative to the camera, Q/E down/up, Shift boosts ----
  const keys = new Set();
  const MOVE = { w: 'f', arrowup: 'f', s: 'b', arrowdown: 'b', a: 'l', arrowleft: 'l', d: 'r', arrowright: 'r', e: 'u', q: 'd' };
  function setPilot(on) {
    ui.pilot = on;
    document.body.classList.toggle('piloting', on);
    if (on && !(ui.focus && ui.focus.kind === 'ship')) { ui.focus = { kind: 'ship', id: 'ship' }; panel.show(null); }
  }
  addEventListener('keydown', e => {
    if (typing(e)) return;
    const k = e.key.toLowerCase();
    if (MOVE[k]) {
      e.preventDefault();
      if (galaxy.ship.captured || galaxy.ship.gone) return; // past the horizon nothing answers the controls
      keys.add(MOVE[k]); if (!ui.pilot) setPilot(true); lastInput = performance.now(); return;
    }
    if (k === 'shift') { keys.add('boost'); return; }
    if (k === 'escape') { if (ui.pilot) setPilot(false); setFocus(null); }
    if (k === 'enter' && ui.near) { e.preventDefault(); setFocus({ kind: ui.near.kind, id: ui.near.id }); panel.focusComm(); }
    if (k === 'p') setPilot(!ui.pilot); // autopilot on/off
    if (k === 'v') setFocus({ kind: 'ship', id: 'ship' });
  });
  addEventListener('keyup', e => { const k = e.key.toLowerCase(); if (MOVE[k]) keys.delete(MOVE[k]); if (k === 'shift') keys.delete('boost'); });
  addEventListener('blur', () => keys.clear());
  function thrust() {
    if (galaxy.ship.captured || galaxy.ship.gone) return [0, 0, 0];
    const f = V.norm([cam.fw[0], 0, cam.fw[2]]), r = V.norm([cam.right[0], 0, cam.right[2]]);
    let v = [0, 0, 0];
    if (keys.has('f')) v = V.add(v, f);
    if (keys.has('b')) v = V.sub(v, f);
    if (keys.has('r')) v = V.add(v, r);
    if (keys.has('l')) v = V.sub(v, r);
    if (keys.has('u')) v = V.add(v, [0, 1, 0]);
    if (keys.has('d')) v = V.sub(v, [0, 1, 0]);
    const l = V.len(v);
    return l ? V.mul(v, (keys.has('boost') ? 2.6 : 1) / l) : v;
  }
  const near = document.getElementById('near');
  document.getElementById('home').addEventListener('click', () => { if (ui.pilot) setPilot(false); setFocus(null); });

  function showTip(h, x, y) {
    const s = galaxy.snap;
    if (!h || !s || drag) { tip.hidden = true; return; }
    let html = '';
    if (h.kind === 'planet') {
      const pl = galaxy.planets.get(h.id);
      if (pl) {
        const st = STATUS[pl.s.status] || STATUS.idle;
        const what = pl.fall > 0.02 ? 'caindo no Gargantua' : pl.s.status === 'working' ? ACTIVITY[pl.s.activity] || st.label : st.label;
        html = `<b>${esc(pl.s.title)}</b><span style="color:${pl.fall > 0.02 ? '#ff967a' : st.color}">${esc(pl.repo)} · ${esc(what)}</span>${pl.s.doing ? `<em>${esc(pl.s.doing)}</em>` : ''}${pl.s.prompt ? `<small>“${esc(pl.s.prompt)}”</small>` : ''}`;
      }
    } else if (h.kind === 'moon') {
      const m = galaxy.findMoon(h.id);
      if (m) html = `<b>${esc(m.a.type)}</b><span style="color:${m.a.active ? STATUS.working.color : STATUS.dormant.color}">${m.a.active ? esc(ACTIVITY[m.a.activity] || 'ativo') : 'concluído'}</span><small>${esc(m.a.description || '')}</small>`;
    } else if (h.kind === 'ship') html = `<b>${esc((SHIPS.find(x => x.id === ui.shipKind) || SHIPS[0]).label)}</b><span>você</span><small>clique para ver quem está chamando</small>`;
    tip.innerHTML = html;
    tip.hidden = !html;
    tip.style.transform = `translate(${Math.min(x + 16, innerWidth - 300)}px, ${y + 16}px)`;
  }

  // ---- loop ----
  const t0 = performance.now();
  let prev = performance.now(), hits = [], tuneAt = 0, hudAt = 0;
  function loop(ts) {
    const dt = Math.min(0.1, (ts - prev) / 1000); prev = ts; ui.dt = dt;
    frameMs = frameMs * 0.95 + (dt * 1000) * 0.05;
    if (ts - tuneAt > 2500 && ts - t0 > 3000) { // keep it smooth: trade ray-march resolution for frame rate
      tuneAt = ts;
      const q = frameMs > 28 ? Math.max(0.28, quality - 0.08) : frameMs < 17.5 ? Math.min(0.8, quality + 0.05) : quality;
      if (Math.abs(q - quality) > 0.01) { quality = q; resize(); }
    }
    const t = (ts - t0) / 1000;
    ui.thrust = ui.pilot ? thrust() : [0, 0, 0];
    if (ui.focus && ui.focus.kind !== 'ship' && !galaxy.posOf(ui.focus, t)) setFocus(null); // swallowed by the hole
    near.hidden = !ui.near;
    if (ui.near) near.textContent = `Enter · abrir canal com ${ui.near.name}`;
    if (!ui.focus && ts - lastInput > 12000) cam.yaw += dt * 0.012; // a slow cinematic drift when nobody is touching
    if (ui.focus) {
      const p = galaxy.posOf(ui.focus, t);
      if (p) { cam.want.target = p; if (!cam.wantSet || cam.wantSet !== ui.focus) { cam.want.dist = galaxy.sizeOf(ui.focus); cam.wantSet = ui.focus; } }
    } else cam.wantSet = null;
    cam.update(dt);
    if (bh) bh.render(cam, t);
    ctx.clearRect(0, 0, cam.W, cam.H);
    ctxb.clearRect(0, 0, cam.W, cam.H);
    hits = galaxy.draw(ctxb, ctx, cam, t, ui);
    if (ts - hudAt > 500) {
      hudAt = ts;
      const st = galaxy.stats();
      set('n-planets', st.shown); set('n-moons', st.moons); set('n-falling', st.falling);
      drawPreviews(t);
    }
    requestAnimationFrame(loop);
  }
  requestAnimationFrame(loop);

  window.__gargantua = { cam, galaxy, setFocus, ui };
})();
