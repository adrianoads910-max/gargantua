'use strict';
// The 2D layers around the black hole: every session is a planet on an orbit around Gargantua, its
// subagents are moons, and you fly the ship. Sessions that sit still spiral slowly into the hole.
// Bodies behind Gargantua are drawn on the layer *under* the hole, whose alpha masks them; the rest
// are drawn on the layer above.

const STATUS = {
  working: { color: '#ffb35c', rgb: '255,179,92', label: 'trabalhando' },
  ask: { color: '#ff5a4f', rgb: '255,90,79', label: 'precisa de você' },
  idle: { color: '#7fd4ff', rgb: '127,212,255', label: 'sua vez' },
  dormant: { color: '#7b8494', rgb: '123,132,148', label: 'dormente' },
};
const ACTIVITY = {
  edit: 'editando', read: 'lendo', terminal: 'no terminal', web: 'na web', delegate: 'delegando',
  skill: 'usando skill', mcp: 'usando MCP', thinking: 'pensando', other: 'trabalhando',
  ask: 'precisa de você', idle: 'sua vez', dormant: 'dormente',
};

const ORBIT0 = 21;
const HORIZON_R = 1.6;          // where a falling orbit ends (inside the shadow, so it vanishes first)
const FALL_START_MIN = 5;       // a session still for this long starts to fall
const orbitStep = n => Math.max(3, Math.min(6, 28 / Math.max(1, n - 1)));
const orbitOf = (i, n) => ORBIT0 + i * orbitStep(n);
const outerOrbit = n => orbitOf(Math.max(0, n - 1), n) + 4;

const clamp01 = x => Math.max(0, Math.min(1, x));
const smooth = (a, b, x) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

// how far into the fall a session is (0 in orbit, 1 at the horizon), from how long it has been still
function fallOf(s, nowMs, spanMin) {
  if (s.status !== 'idle' && s.status !== 'dormant') return 0;
  const still = (nowMs - (s.lastTs || nowMs)) / 60000;
  return Math.pow(clamp01((still - FALL_START_MIN) / spanMin), 1.2);
}
// what the hole does to a body at orbit radius R, as seen from far away
function horizonFx(R) {
  return {
    dil: Math.max(0.02, Math.pow(clamp01((R - 2) / 4.5), 1.3)), // time dilation: it slows down
    fade: smooth(2.3, 4.4, R),                                   // dims and redshifts away
    stretch: 1 + Math.max(0, 6 - R) * 0.55,                      // tidal stretch toward the hole
  };
}

function createGalaxy(opts = {}) {
  const spanMin = opts.fallMinutes || 175; // the collector keeps sessions for 3 h: the fall ends about then
  const planets = new Map();
  const moonTex = new Map();
  const ship = { pos: [70, 6, 20], vel: [0, 0, 0], dir: [0, 0, -1], trail: [], heading: -Math.PI / 2, captured: false, capT: 0, gone: false, goneT: 0 };
  let snap = null;
  const shadeCanvas = document.createElement('canvas');
  const sliceCanvas = document.createElement('canvas');

  function update(s) {
    snap = s;
    const list = s.planets.flatMap(p => p.sessions.map(x => ({ s: x, repo: p.name, repoId: p.id })));
    list.sort((a, b) => a.repo.localeCompare(b.repo) || a.s.id.localeCompare(b.s.id)); // a repository's sessions sit side by side
    const seen = new Set();
    list.forEach(({ s: ses, repo, repoId }, i) => {
      seen.add(ses.id);
      let pl = planets.get(ses.id);
      if (!pl) {
        const h = strHash(ses.id);
        const { tex, world, clouds } = planetTexture(ses.id, repo);
        pl = {
          id: ses.id, tex, world, clouds, angle: (h % 6283) / 1000, incl: ((h >> 8) % 100 - 50) / 50 * 0.07, tilt: 0.25 + ((h >> 4) % 100) / 100 * 0.4,
          spin: 0.035 + ((h >> 12) % 100) / 100 * 0.03, // turns per second at rest
          rot: ((h >> 16) % 100) / 100, crot: ((h >> 20) % 100) / 100, R: null,
        };
        planets.set(ses.id, pl);
      }
      pl.s = ses; pl.repo = repo; pl.repoId = repoId;
      pl.R0 = orbitOf(i, list.length);
      pl.radius = 1.6 + Math.min(1.4, Math.sqrt(ses.turns || 0) / 6);
    });
    for (const id of [...planets.keys()]) if (!seen.has(id)) planets.delete(id);
  }

  // ---- motion (integrated per frame: a falling orbit speeds up, then time dilation freezes it) ----
  function step(dt) {
    const now = Date.now();
    for (const pl of planets.values()) {
      pl.fall = fallOf(pl.s, now, spanMin);
      if (pl.forced) pl.fall = Math.max(pl.fall, clamp01((now - pl.forced.at) / pl.forced.ms)); // the tour shows a whole fall in seconds
      const want = pl.R0 + (HORIZON_R - pl.R0) * pl.fall;
      if (pl.R == null) pl.R = pl.fall > 0 ? want : pl.R0 + 14; // a new session flies in from outside
      pl.R += (want - pl.R) * (1 - Math.exp(-dt * (pl.forced ? 1.6 : 0.35)));
      pl.fx = horizonFx(pl.R);
      pl.angle += dt * 1.4 / Math.pow(Math.max(pl.R, 2), 1.5) * pl.fx.dil;
      // spin: a working session turns faster, a closed one almost stops, and near the horizon time freezes it
      const busy = pl.s.status === 'working' || pl.s.status === 'ask' ? 1.9 : pl.s.status === 'dormant' ? 0.35 : 1;
      const rate = pl.spin * busy * pl.fx.dil;
      pl.rot += dt * rate;
      pl.crot += dt * rate * 1.45; // weather runs ahead of the ground
    }
  }
  const planetPos = pl => {
    const inc = pl.incl * clamp01(pl.R / 10), a = pl.angle;
    return [pl.R * Math.cos(a), pl.R * Math.sin(a) * Math.sin(inc), pl.R * Math.sin(a) * Math.cos(inc)];
  };
  const moonPos = (pl, j, t) => {
    const c = planetPos(pl), rm = pl.radius * 1.9 + j * 0.85, b = j * 2.4 + t * 0.6 / (1 + j * 0.3) * pl.fx.dil + pl.angle;
    return [c[0] + rm * Math.cos(b), c[1] + rm * Math.sin(b) * Math.sin(pl.tilt), c[2] + rm * Math.sin(b) * Math.cos(pl.tilt)];
  };
  const visible = pl => pl.fx && pl.fx.fade > 0.02;

  function findMoon(key) {
    const [sid, aid] = String(key).split(':');
    const pl = planets.get(sid);
    if (!pl) return null;
    const j = pl.s.subagents.findIndex(a => a.id === aid);
    return j >= 0 ? { pl, j, a: pl.s.subagents[j] } : null;
  }
  function posOf(f, t) {
    if (!f) return [0, 0, 0];
    if (f.kind === 'planet') { const pl = planets.get(f.id); return pl && visible(pl) ? planetPos(pl) : null; }
    if (f.kind === 'moon') { const m = findMoon(f.id); return m && visible(m.pl) ? moonPos(m.pl, m.j, t) : null; }
    if (f.kind === 'ship') return ship.pos;
    return [0, 0, 0];
  }
  function sizeOf(f) {
    if (!f) return 80;
    if (f.kind === 'planet') { const pl = planets.get(f.id); return pl ? 16 + pl.radius * 10 : 60; }
    return 14;
  }

  // ---- drawing helpers ----
  // A lit, textured sphere centred on (0,0) of the current transform: the texture strip is mapped onto the
  // visible hemisphere in vertical slices (whole pixels, offscreen: no seams), Lambert shading on top.
  // L is the direction to the light in view space (x right, y up, z toward the viewer).
  // opaque layers overlap their slices by a pixel (no gaps); translucent ones must not (no doubled stripes)
  function strip(oc, tex, rot, n, translucent) {
    const W = tex.width, H = tex.height, N = Math.max(6, Math.min(48, Math.ceil(n / 4)));
    for (let k = 0; k < N; k++) {
      const x0 = -1 + 2 * k / N, x1 = -1 + 2 * (k + 1) / N;
      const u0 = Math.asin(x0) / Math.PI + 0.5, u1 = Math.asin(x1) / Math.PI + 0.5;
      const sw = Math.max(1, (u1 - u0) * 0.5 * W);
      const px0 = translucent ? (x0 + 1) / 2 * n : Math.floor((x0 + 1) / 2 * n);
      const pw = translucent ? (x1 - x0) / 2 * n : Math.max(1, Math.ceil((x1 + 1) / 2 * n) - px0) + 1;
      const sx = ((rot + u0 * 0.5) % 1 + 1) % 1 * W;
      if (sx + sw <= W) { oc.drawImage(tex, sx, 0, sw, H, px0, 0, pw, n); continue; }
      const a = W - sx, f = a / sw; // the slice wraps around the seam: draw both pieces
      oc.drawImage(tex, sx, 0, a, H, px0, 0, pw * f, n);
      oc.drawImage(tex, 0, 0, sw - a, H, px0 + pw * f, 0, pw * (1 - f), n);
    }
  }
  function body(ctx, tex, r, rot, L, rgbAtmo, clouds, crot) {
    const n = Math.max(8, Math.min(320, Math.ceil(r * 2 * Math.min(2, devicePixelRatio || 1))));
    if (sliceCanvas.width !== n) { sliceCanvas.width = n; sliceCanvas.height = n; }
    const oc = sliceCanvas.getContext('2d');
    oc.clearRect(0, 0, n, n);
    strip(oc, tex, rot, n);
    if (clouds) strip(oc, clouds, crot, n, true);
    const m = Math.max(8, Math.min(140, Math.ceil(r * 2)));
    if (shadeCanvas.width !== m) { shadeCanvas.width = m; shadeCanvas.height = m; }
    const sc = shadeCanvas.getContext('2d'), img = sc.createImageData(m, m), d = img.data;
    for (let j = 0; j < m; j++) for (let i = 0; i < m; i++) {
      let nx = (i + 0.5) / m * 2 - 1, ny = 1 - (j + 0.5) / m * 2, q = nx * nx + ny * ny;
      if (q > 1) { const l = Math.sqrt(q); nx /= l; ny /= l; q = 1; } // past the rim: repeat the rim, the clip cuts it
      const nz = Math.sqrt(1 - q);
      const lam = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const k = (j * m + i) * 4;
      d[k] = 0; d[k + 1] = 0; d[k + 2] = 3; d[k + 3] = (1 - (0.17 + 0.83 * Math.pow(lam, 0.8))) * 255;
    }
    sc.putImageData(img, 0, 0);
    ctx.save();
    ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.clip();
    ctx.drawImage(sliceCanvas, -r, -r, r * 2, r * 2);
    ctx.drawImage(shadeCanvas, -r, -r, r * 2, r * 2);
    ctx.restore();
    if (rgbAtmo) { // a thin atmosphere on the lit limb
      const ang = Math.atan2(-L[1], L[0]), spread = 1.25 * Math.max(0.15, 1 - Math.max(0, L[2]) * 0.6);
      ctx.save();
      ctx.lineWidth = Math.max(1, r * 0.09);
      ctx.strokeStyle = `rgba(${rgbAtmo},${0.45 + 0.18 * Math.sin(rot * Math.PI * 4)})`; // the limb brightens and dims as weather turns past it
      ctx.shadowColor = `rgba(${rgbAtmo},0.8)`; ctx.shadowBlur = r * 0.35;
      ctx.beginPath(); ctx.arc(0, 0, r * 0.99, ang - spread, ang + spread); ctx.stroke();
      ctx.restore();
    }
  }

  // stretched toward the hole, dimmed and reddened: what falling looks like from far away
  function tidal(ctx, x, y, bh, fx, draw) {
    ctx.save();
    ctx.translate(x, y);
    if (fx.stretch > 1.01 && bh) {
      const a = Math.atan2(bh.y - y, bh.x - x);
      ctx.rotate(a); ctx.scale(fx.stretch, 1 / Math.sqrt(fx.stretch)); ctx.rotate(-a);
    }
    ctx.globalAlpha *= fx.fade;
    const red = 1 - fx.fade;
    if (red > 0.03) ctx.filter = `sepia(${red}) saturate(${1 + red * 3}) hue-rotate(${-25 * red}deg) brightness(${1 - red * 0.4})`;
    draw();
    ctx.restore();
  }

  function lightIn(cam, wp) { // direction from the body toward Gargantua, in view space
    const L = V.norm(V.mul(wp, -1));
    return [V.dot(L, cam.right), V.dot(L, cam.up), -V.dot(L, cam.fw)];
  }

  function ellipse(ctx, cam, center, radius, tilt, color, width, side, cz) {
    // a circle in a tilted plane around `center`; side: 0 all, -1 the part farther than depth cz, 1 the nearer part
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = width;
    ctx.beginPath();
    let pen = false;
    const N = 96;
    for (let i = 0; i <= N; i++) {
      const b = i / N * Math.PI * 2;
      const p = cam.project([center[0] + radius * Math.cos(b), center[1] + radius * Math.sin(b) * Math.sin(tilt), center[2] + radius * Math.sin(b) * Math.cos(tilt)]);
      const keep = p && (!side || (side < 0 ? p.z >= cz : p.z < cz));
      if (!keep) { pen = false; continue; }
      if (pen) ctx.lineTo(p.x, p.y); else { ctx.moveTo(p.x, p.y); pen = true; }
    }
    ctx.stroke();
    ctx.restore();
  }

  function label(ctx, text, x, y, color, size, alpha, align) {
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    ctx.font = `600 ${size || 11}px "Inter", "Segoe UI", system-ui, sans-serif`;
    if ('letterSpacing' in ctx) ctx.letterSpacing = '0.16em';
    ctx.textAlign = align || 'center'; ctx.textBaseline = 'top';
    ctx.shadowColor = 'rgba(0,0,0,0.9)'; ctx.shadowBlur = 6;
    ctx.fillStyle = color || 'rgba(235,225,210,0.9)';
    ctx.fillText(text, x, y);
    ctx.restore();
  }
  const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

  function moonTexFor(id) {
    if (!moonTex.has(id)) moonTex.set(id, moonTexture(strHash(id)));
    return moonTex.get(id);
  }

  // ---- the ship ----
  function fly(ui, t) {
    const dt = ui.dt;
    if (ship.gone) {
      ship.goneT += dt;
      if (ship.goneT > 3) { // back through the tesseract, at the edge of the galaxy
        const a = Math.random() * Math.PI * 2, R = outerOrbit(planets.size) + 10;
        Object.assign(ship, { pos: [Math.cos(a) * R, 5, Math.sin(a) * R], vel: [0, 0, 0], trail: [], captured: false, capT: 0, gone: false, goneT: 0 });
        ui.onRespawn && ui.onRespawn();
      }
      return;
    }
    if (ship.captured) { // no way out: seen from outside the fall slows forever, until the light is gone
      ship.capT += dt;
      ship.pos = V.mul(ship.capDir, 1.25 + (ship.capR - 1.25) * Math.exp(-ship.capT * 0.45));
      if (ship.capT > 7) { ship.gone = true; ship.goneT = 0; ui.onSwallowed && ui.onSwallowed(); }
      return;
    }
    if (ui.pilot) {
      const r = V.len(ship.pos);
      const dil = Math.max(0.04, Math.pow(clamp01((r - 2.2) / 5), 1.2)); // time slows near the hole
      const pull = V.mul(V.norm(ship.pos), -45 / (r * r));
      ship.vel = V.add(V.mul(ship.vel, Math.exp(-dt * 1.6)), V.mul(V.add(V.mul(ui.thrust, 26), pull), dt));
      ship.pos = V.add(ship.pos, V.mul(ship.vel, dt * dil));
      const r2 = V.len(ship.pos);
      if (r2 < 3.4) { Object.assign(ship, { captured: true, capT: 0, capR: r2, capDir: V.norm(ship.pos), vel: [0, 0, 0] }); ui.onCaptured && ui.onCaptured(); }
      if (r2 > 320) ship.pos = V.mul(V.norm(ship.pos), 320);
    } else {
      const you = snap && snap.you && planets.get(snap.you.session);
      let want;
      if (you && you.fx && you.fx.fade > 0.6) {
        const c = planetPos(you), a = t * 0.4, d = you.radius * 2.6;
        want = [c[0] + Math.cos(a) * d, c[1] + you.radius * 0.9, c[2] + Math.sin(a) * d];
      } else {
        const a = t * 0.02, R = outerOrbit(planets.size) + 6;
        want = [Math.cos(a) * R, 4, Math.sin(a) * R];
      }
      ship.pos = V.lerp(ship.pos, want, Math.min(1, dt * 0.9));
      ship.vel = [0, 0, 0];
    }
  }

  // ---- the frame ----
  function draw(back, front, cam, t, ui) {
    const hits = [];
    if (!snap) return hits;
    step(ui.dt);
    const bh = cam.project([0, 0, 0]);
    const behind = z => bh && z > bh.z;
    const shadowPx = bh ? BH.SHADOW * bh.s : 0;
    const masked = (p, r) => behind(p.z) && Math.hypot(p.x - bh.x, p.y - bh.y) < shadowPx * 1.6 + r * 0.3; // not clickable through the hole
    const focusId = ui.focus && ui.focus.id, hoverId = ui.hover && ui.hover.id;
    const items = [];
    let ctx = front; // each item draws on the layer chosen for its depth

    // orbit lanes: the far half under the hole, the near half above it
    for (const pl of planets.values()) {
      if (!visible(pl)) continue;
      const on = focusId === pl.id || hoverId === pl.id;
      const col = on ? `rgba(255,214,170,${0.4 * pl.fx.fade})` : pl.fall > 0.01 ? `rgba(255,150,110,${0.14 * pl.fx.fade})` : 'rgba(255,230,200,0.09)';
      const inc = pl.incl * clamp01(pl.R / 10);
      if (bh) { ellipse(back, cam, [0, 0, 0], pl.R, inc, col, on ? 1.2 : 1, -1, bh.z); ellipse(front, cam, [0, 0, 0], pl.R, inc, col, on ? 1.2 : 1, 1, bh.z); }
      else ellipse(front, cam, [0, 0, 0], pl.R, inc, col, 1);
    }

    for (const pl of planets.values()) {
      if (!visible(pl)) continue;
      const s = pl.s, fx = pl.fx;
      const wp = planetPos(pl), pp = cam.project(wp);
      if (!pp) continue;
      const r = pl.radius * pp.s;
      const st = STATUS[s.status] || STATUS.idle;
      const L = lightIn(cam, wp);
      items.push({
        z: pp.z, draw() {
          if (r < 0.3) return;
          tidal(ctx, pp.x, pp.y, bh, fx, () => {
            if (s.status === 'working' || s.status === 'ask') {
              const g = ctx.createRadialGradient(0, 0, 0, 0, 0, r * 2.3), a = 0.13 + 0.07 * Math.sin(t * (s.status === 'ask' ? 5 : 2));
              g.addColorStop(0, `rgba(${st.rgb},${a})`); g.addColorStop(1, `rgba(${st.rgb},0)`);
              ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, r * 2.3, 0, Math.PI * 2); ctx.fill();
            }
            if (s.status === 'dormant') ctx.globalAlpha *= 0.75;
            body(ctx, pl.tex, r, pl.rot, L, pl.world.atmo, pl.clouds, pl.crot);
          });
          const a = fx.fade;
          if (s.status === 'ask') {
            const k = (t * 18) % 16;
            ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = `rgba(${st.rgb},${1 - k / 16})`; ctx.lineWidth = 1.5;
            ctx.beginPath(); ctx.arc(pp.x, pp.y, r + 4 + k, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
            label(ctx, '!', pp.x, pp.y - r - 22, st.color, 14, a);
          }
          const on = focusId === pl.id || hoverId === pl.id;
          label(ctx, cut(s.title, 32).toUpperCase(), pp.x, pp.y + r + 8, on ? '#fff3e2' : 'rgba(235,225,210,0.88)', 10.5, a);
          if (on || s.status === 'ask') {
            const what = s.status === 'working' ? (ACTIVITY[s.activity] || st.label) : pl.fall > 0.02 ? 'caindo no Gargantua' : st.label;
            label(ctx, `${pl.repo} · ${what}`, pp.x, pp.y + r + 22, pl.fall > 0.02 ? 'rgba(255,150,110,0.85)' : st.color, 9, a * 0.85);
          }
          if (!masked(pp, r)) hits.push({ x: pp.x, y: pp.y, r: Math.max(r, 10), z: pp.z, kind: 'planet', id: pl.id });
        },
      });

      // moons: the session's subagents
      s.subagents.forEach((ag, j) => {
        const mw = moonPos(pl, j, t), mp = cam.project(mw);
        if (!mp) return;
        const mr = Math.max(2.4, (ag.active ? 0.5 : 0.4) * mp.s), key = s.id + ':' + ag.id;
        const ml = lightIn(cam, mw);
        items.push({
          z: mp.z, draw() {
            tidal(ctx, mp.x, mp.y, bh, fx, () => {
              if (ag.active) {
                const pulse = 0.5 + 0.5 * Math.sin(t * 3 + j);
                const g = ctx.createRadialGradient(0, 0, 0, 0, 0, mr * 3 + 4);
                g.addColorStop(0, `rgba(${STATUS.working.rgb},${0.35 + pulse * 0.25})`); g.addColorStop(1, `rgba(${STATUS.working.rgb},0)`);
                ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, mr * 3 + 4, 0, Math.PI * 2); ctx.fill();
              } else ctx.globalAlpha *= 0.6;
              body(ctx, moonTexFor(key), mr, t * 0.08 * fx.dil + j, ml, null);
            });
            if (key === focusId || key === hoverId || focusId === s.id) label(ctx, cut(`${ag.type} · ${ag.description || ''}`, 40), mp.x + mr + 7, mp.y - 5, ag.active ? STATUS.working.color : 'rgba(200,200,210,0.8)', 9, fx.fade, 'left');
            if (!masked(mp, mr)) hits.push({ x: mp.x, y: mp.y, r: Math.max(mr + 3, 8), z: mp.z, kind: 'moon', id: key });
          },
        });
      });
    }

    // the ship
    const before = ship.pos;
    fly(ui, t);
    const moved = V.sub(ship.pos, before);
    const speed = V.len(moved) / Math.max(ui.dt, 1e-3);
    const flat = [moved[0], 0, moved[2]]; // the ship keeps level: its nose follows the horizontal direction of travel
    if (V.len(flat) > 1e-4 && !ship.captured) ship.dir = V.norm(V.lerp(ship.dir, V.norm(flat), Math.min(1, ui.dt * 4)));
    // how the camera sees the ship: heading in its plane (as from above) and elevation over that plane
    const rightH = V.norm([cam.right[0], 0, cam.right[2]]), fwH = V.norm([cam.fw[0], 0, cam.fw[2]]);
    const shipView = { a: Math.atan2(-V.dot(ship.dir, fwH), V.dot(ship.dir, rightH)), s: Math.abs(V.norm(V.sub(cam.pos, ship.pos))[1]) };
    let near = null;
    if (ui.pilot && !ship.captured && !ship.gone) {
      for (const pl of planets.values()) {
        if (!visible(pl)) continue;
        const c = planetPos(pl), d = V.len(V.sub(ship.pos, c)) - pl.radius;
        if (d < 3.2 && (!near || d < near.d)) near = { kind: 'planet', id: pl.id, name: pl.s.title, d, wp: c, r: pl.radius };
      }
    }
    ui.near = near;
    if (near) {
      const np = cam.project(near.wp);
      if (np) items.push({
        z: -1e10, draw() {
          const rr = near.r * np.s + 10;
          ctx.save(); ctx.setLineDash([4, 6]); ctx.lineDashOffset = -t * 20;
          ctx.strokeStyle = 'rgba(150,210,255,0.85)'; ctx.lineWidth = 1.2;
          ctx.beginPath(); ctx.arc(np.x, np.y, rr, 0, Math.PI * 2); ctx.stroke(); ctx.restore();
          label(ctx, 'ENTER · ABRIR CANAL', np.x, np.y - rr - 16, 'rgba(170,215,255,0.95)', 9);
        },
      });
    }
    const sp = !ship.gone && cam.project(ship.pos);
    if (sp) {
      const lastT = ship.trail[ship.trail.length - 1];
      if (lastT && Math.hypot(lastT[0] - sp.x, lastT[1] - sp.y) > 60) ship.trail = [];
      if (lastT && Math.hypot(lastT[0] - sp.x, lastT[1] - sp.y) > 0.4) ship.heading = Math.atan2(sp.y - lastT[1], sp.x - lastT[0]);
      ship.trail.push([sp.x, sp.y]); if (ship.trail.length > 26) ship.trail.shift();
      const rr = V.len(ship.pos);
      const sfx = ship.captured
        ? { fade: Math.max(0, 1 - ship.capT / 7), stretch: 1 + ship.capT * 1.3 }
        : { fade: 1, stretch: 1 + Math.max(0, 7 - rr) * 0.12 };
      items.push({
        z: sp.z, draw() {
          if (!ship.captured && speed > 0.6 && ship.trail.length > 2) {
            ctx.save(); ctx.lineCap = 'round';
            for (let i = 1; i < ship.trail.length; i++) {
              const a = i / ship.trail.length;
              ctx.strokeStyle = `rgba(150,210,255,${a * 0.5})`; ctx.lineWidth = a * 3;
              ctx.beginPath(); ctx.moveTo(...ship.trail[i - 1]); ctx.lineTo(...ship.trail[i]); ctx.stroke();
            }
            ctx.restore();
          }
          const R = Math.max(7, Math.min(26, sp.s * 0.55));
          if (ui.pilot && !ship.captured && speed > 0.3 && ui.shipKind !== 'falcon') { // engine glow behind the direction of travel
            glow(ctx, sp.x - Math.cos(ship.heading) * R * 0.9, sp.y - Math.sin(ship.heading) * R * 0.9, R * 0.9, '140,200,255', 0.55);
          }
          tidal(ctx, sp.x, sp.y, bh, sfx, () => drawShip(ui.shipKind, ctx, R, t, shipView));
          const waiting = snap.you && snap.you.waiting;
          const tag = ship.captured ? 'VOCÊ · HORIZONTE DE EVENTOS' : ui.pilot ? 'VOCÊ · PILOTANDO' : waiting ? 'VOCÊ · CHAMADO' : 'VOCÊ';
          label(ctx, tag, sp.x, sp.y - R * 1.2 - 16, ship.captured ? 'rgba(255,140,100,0.95)' : waiting && !ui.pilot ? STATUS.ask.color : 'rgba(170,215,255,0.95)', 9, Math.max(0.2, sfx.fade));
          hits.push({ x: sp.x, y: sp.y, r: Math.max(R, 10), z: sp.z, kind: 'ship', id: 'ship' });
        },
      });
    }

    items.sort((a, b) => b.z - a.z);
    for (const it of items) { ctx = behind(it.z) ? back : front; it.draw(); }
    return hits;
  }

  function stats() { // what the top bar counts, as the galaxy shows it
    let falling = 0, moons = 0, shown = 0;
    for (const pl of planets.values()) {
      if (!visible(pl)) continue;
      shown++;
      if (pl.fall > 0.02) falling++;
      moons += pl.s.subagents.filter(a => a.active).length;
    }
    return { shown, falling, moons };
  }

  function forceFall(id, seconds) { const pl = planets.get(id); if (pl) pl.forced = { at: Date.now(), ms: seconds * 1000 }; }

  return { update, draw, posOf, sizeOf, findMoon, planets, ship, stats, forceFall, get snap() { return snap; } };
}
