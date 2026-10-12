'use strict';
// ?tour — a scripted camera tour for screen recording (best with the demo: npm run demo).
// Space starts it, R restarts. ?legenda=1 burns the narration in as captions.
// The timeline follows the narration of the showcase video, about 37 s.

(function () {
  const params = new URLSearchParams(location.search);
  if (!params.has('tour')) return;
  const G = window.__gargantua;
  document.body.classList.add('tour');

  const SAY = [
    [0, 'Eu transformei meus agentes de IA numa galáxia.'],
    [3.6, 'Cada planeta é uma sessão do Claude trabalhando.'],
    [11, 'As luas são os subagentes.'],
    [14.5, 'Quando um agente fica parado… ele começa a cair no buraco negro.'],
    [21.5, 'E essa nave sou eu. Ela voa até o agente que precisa de mim.'],
    [28, 'Mas se eu chegar perto demais…'],
    [34, 'Código aberto. Link na bio.'],
  ];

  const el = (cls, html) => { const d = document.createElement('div'); d.className = cls; d.innerHTML = html; document.body.appendChild(d); return d; };
  const hint = el('tour-hint', '<b>Modo tour</b> · comece a gravar e aperte <kbd>Espaço</kbd> · <kbd>R</kbd> recomeça');
  const caption = el('tour-caption', '');
  const end = el('tour-end', '<div class="tour-end-k">Node.js · WebGL · zero dependências</div><div class="tour-end-t">Código <em>aberto</em></div><div class="tour-end-r">github.com/adrianoads910-max/gargantua</div><div class="tour-end-b">Link na bio ↓</div>');
  caption.hidden = params.get('legenda') !== '1';
  end.hidden = true;

  const planets = () => [...G.galaxy.planets.values()].filter(p => p.fx && p.fx.fade > 0.5);
  const pick = (...tests) => { for (const t of tests) { const p = planets().find(t); if (p) return p; } return planets()[0]; };

  let t0 = 0, running = false, done = new Set(), spin = 0, picks = {};
  const at = (time, key, fn, t) => { if (t >= time && !done.has(key)) { done.add(key); fn(); } };

  function start() {
    if (!G.galaxy.snap || !G.galaxy.planets.size) return setTimeout(start, 300);
    hint.hidden = true; end.hidden = true; document.body.classList.remove('tour-ending');
    done = new Set(); running = true; t0 = performance.now();
    picks = {
      busy: pick(p => p.s.status === 'working' && p.s.subagents.length, p => p.s.status === 'working'),
      moons: pick(p => p.s.subagents.length > 1, p => p.s.subagents.length),
      still: pick(p => p.s.status === 'idle' && p.fall < 0.3, p => p.s.status === 'idle', p => p.s.status === 'dormant'),
    };
    G.setPilot(false);
  }

  function tick(now) {
    requestAnimationFrame(tick);
    if (!running) return;
    const t = (now - t0) / 1000, cam = G.cam;
    const line = SAY.filter(([s]) => t >= s).pop();
    if (line && caption.textContent !== line[1]) caption.textContent = line[1];
    cam.yaw += spin * G.ui.dt;

    // 1 · close to the hole, low and slow, like the film
    at(0, 'hook', () => { G.setFocus(null); cam.want.dist = 46; cam.pitch = 0.07; spin = 0.05; }, t);
    // 2 · the galaxy, then a working session with its prompt and reply
    at(3.6, 'wide', () => { cam.want.dist = 150; spin = 0.03; cam.pitch = 0.32; }, t);
    at(7, 'busy', () => { spin = 0; G.setFocus({ kind: 'planet', id: picks.busy.id }); }, t);
    // 3 · moons
    at(11, 'moons', () => { G.panel.close(); G.ui.focus = { kind: 'planet', id: picks.moons.id }; G.cam.wantSet = null; spin = 0.12; cam.pitch = 0.45; }, t);
    at(11.3, 'moons-close', () => { cam.want.dist = 30; }, t);
    // 4 · a still session spirals into the hole (sped up); the camera rides along until it is gone
    at(14.5, 'fall', () => { spin = 0; G.galaxy.forceFall(picks.still.id, 6); G.ui.focus = { kind: 'planet', id: picks.still.id }; G.cam.wantSet = null; cam.pitch = 0.3; }, t);
    at(15, 'fall-wide', () => { cam.want.dist = 34; }, t);
    at(20.5, 'fall-home', () => { G.setFocus(null); cam.want.dist = 60; cam.pitch = 0.18; }, t);
    // 5 · the ship flies in from far away to whoever needs you
    at(21.5, 'ship', () => {
      const s = G.galaxy.ship, a = Math.random() * 6.28;
      s.pos = [Math.cos(a) * 80, 8, Math.sin(a) * 80]; s.trail = [];
      G.ui.focus = { kind: 'ship', id: 'ship' }; G.cam.wantSet = null; G.panel.close(); cam.pitch = 0.25;
    }, t);
    at(22, 'ship-dist', () => { cam.want.dist = 20; }, t);
    // 6 · too close: captured at the event horizon
    at(28, 'dive', () => {
      G.setPilot(true);
      const s = G.galaxy.ship; s.pos = [5.2, 0.5, 2.6]; s.vel = V.mul(V.norm(s.pos), -3); s.trail = [];
      cam.pitch = 0.22; cam.want.dist = 12;
    }, t);
    // 7 · the end card over a slow orbit
    at(34, 'end', () => { G.setPilot(false); G.setFocus(null); cam.want.dist = 70; cam.pitch = 0.12; spin = 0.04; end.hidden = false; document.body.classList.add('tour-ending'); }, t);
    at(38.5, 'stop', () => { running = false; spin = 0; }, t);
  }
  requestAnimationFrame(tick);

  addEventListener('keydown', e => {
    if (e.key === ' ') { e.preventDefault(); e.stopImmediatePropagation(); if (!running) start(); }
    if (e.key.toLowerCase() === 'r') { e.stopImmediatePropagation(); location.reload(); }
  }, true);
})();
