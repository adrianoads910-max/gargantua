'use strict';
// The ships you can fly, drawn procedurally around (0, 0) as seen from the camera.
// view = { a, s }: `a` is the heading in the ship's horizontal plane as seen from above (screen angle when
// looking straight down: 0 = right, -PI/2 = away from the camera), `s` is the sine of the camera's elevation
// over that plane (1 = from straight above, ~0 = from the side).

const SHIPS = [
  { id: 'endurance', label: 'Endurance', note: 'Interestelar' },
  { id: 'falcon', label: 'Millennium Falcon', note: 'Star Wars' },
  { id: 'deathstar', label: 'Estrela da Morte', note: 'Star Wars' },
];

function glow(ctx, x, y, r, rgb, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, `rgba(${rgb},${a})`); g.addColorStop(1, `rgba(${rgb},0)`);
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
}

function drawShip(kind, ctx, R, t, view) {
  view = view || { a: -Math.PI / 4, s: 0.55 };
  const s = Math.max(0.04, Math.min(1, view.s));
  if (kind === 'falcon') return drawFalcon(ctx, R, t, view.a, s);
  if (kind === 'deathstar') return drawDeathStar(ctx, R * 1.15, t, s);
  return drawEndurance(ctx, R, t, s);
}

// a point of the ship's plane (x right, y forward-is-negative) under heading a, seen at elevation s
function planPoint(x, y, a, s) {
  const c = Math.cos(a + Math.PI / 2), n = Math.sin(a + Math.PI / 2);
  return [x * c - y * n, (x * n + y * c) * s];
}

function drawEndurance(ctx, R, t, s) {
  // twelve modules on a spinning ring around a docking hub; from the side the ring is a line of modules
  ctx.save();
  const tilt = Math.max(0.05, s), spin = t * 0.6;
  glow(ctx, 0, 0, R * 1.8, '150,210,255', 0.12);
  ctx.strokeStyle = 'rgba(210,220,230,0.55)'; ctx.lineWidth = Math.max(0.8, R * 0.05);
  ctx.beginPath(); ctx.ellipse(0, 0, R, R * tilt, 0, 0, Math.PI * 2); ctx.stroke();
  const mods = [];
  for (let k = 0; k < 12; k++) {
    const a = spin + k / 12 * Math.PI * 2;
    mods.push({ a, x: Math.cos(a) * R, y: Math.sin(a) * R * tilt, front: Math.sin(a) > 0 });
  }
  const mod = m => {
    ctx.save(); ctx.translate(m.x, m.y);
    ctx.rotate(Math.atan2(Math.cos(m.a) * tilt, -Math.sin(m.a)));
    // a module is a box: long side along the ring, its height shows more as the view lowers
    const w = R * 0.42, h = R * (0.2 * tilt + 0.16 * (1 - tilt));
    ctx.fillStyle = m.front ? '#e9edf2' : '#9aa3ad';
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.fillStyle = m.front ? 'rgba(255,200,120,0.9)' : 'rgba(255,200,120,0.4)';
    ctx.fillRect(-w * 0.12, -h * 0.18, w * 0.24, h * 0.36);
    ctx.restore();
  };
  mods.filter(m => !m.front).forEach(mod);
  ctx.strokeStyle = 'rgba(220,225,230,0.7)'; ctx.lineWidth = Math.max(0.6, R * 0.035);
  for (let k = 0; k < 4; k++) { const a = spin + k * Math.PI / 2; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R * tilt); ctx.stroke(); }
  // the hub, with its docking spine standing out of the ring plane (seen more from the side)
  const spine = R * 0.34 * (1 - tilt);
  ctx.fillStyle = '#d9dee4';
  ctx.fillRect(-R * 0.06, -spine, R * 0.12, spine * 2);
  ctx.fillStyle = '#f4f6f8';
  ctx.beginPath(); ctx.ellipse(0, 0, R * 0.17, R * 0.17 * Math.max(0.55, tilt), 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = 'rgba(140,200,255,0.9)';
  ctx.beginPath(); ctx.arc(0, 0, R * 0.07, 0, Math.PI * 2); ctx.fill();
  mods.filter(m => m.front).forEach(mod);
  ctx.restore();
}

function falconHull(ctx, r, a, s, dy) {
  // the outline in the ship's plane: a saucer open at the nose, with two mandibles
  const pts = [];
  const N = 40, gap = 0.42;
  for (let i = 0; i <= N; i++) { const th = -Math.PI / 2 + gap + (Math.PI * 2 - gap * 2) * i / N; pts.push([Math.cos(th) * r, Math.sin(th) * r]); }
  pts.push([-r * 0.36, -r * 1.55], [-r * 0.12, -r * 1.55], [-r * 0.1, -r * 0.92], [r * 0.1, -r * 0.92], [r * 0.12, -r * 1.55], [r * 0.36, -r * 1.55]);
  ctx.beginPath();
  pts.forEach(([x, y], i) => { const [px, py] = planPoint(x, y, a, s); i ? ctx.lineTo(px, py + dy) : ctx.moveTo(px, py + dy); });
  ctx.closePath();
}

function drawFalcon(ctx, R, t, a, s) {
  // a saucer: forked mandibles forward, cockpit tube to starboard, blue drive at the back; the hull has
  // thickness, so from the side it reads as a flat disc with a darker belly
  ctx.save();
  const r = R * 0.95, thick = r * 0.26 * Math.sqrt(1 - s * s);
  const P = (x, y, dy = 0) => { const p = planPoint(x, y, a, s); return [p[0], p[1] + dy]; };
  const back = P(0, r * 0.8);
  glow(ctx, back[0], back[1], r * (0.7 + 0.4 * s), '120,190,255', 0.45 + 0.1 * Math.sin(t * 9)); // sublight drive
  // belly (the lower face of the hull) and the rim between the faces
  if (thick > 0.3) {
    ctx.fillStyle = '#5d5b57';
    falconHull(ctx, r, a, s, thick); ctx.fill();
    ctx.fillStyle = '#77756f';
    ctx.fillRect(-r * 1.02, -0.5, r * 2.04, thick + 1); // the rim, seen edge-on
  }
  const hull = ctx.createRadialGradient(-r * 0.3, -r * 0.3 * s, r * 0.1, 0, 0, r * 1.1);
  hull.addColorStop(0, '#eceae4'); hull.addColorStop(1, '#8d8b86');
  ctx.fillStyle = hull;
  falconHull(ctx, r, a, s, 0); ctx.fill();
  ctx.strokeStyle = 'rgba(60,60,60,0.6)'; ctx.lineWidth = Math.max(0.5, r * 0.03); ctx.stroke();
  // plating and the gun well (ellipses flatten with the view)
  ctx.strokeStyle = 'rgba(90,88,84,0.55)';
  ctx.beginPath(); ctx.ellipse(0, 0, r * 0.32, r * 0.32 * s, 0, 0, Math.PI * 2); ctx.stroke();
  for (let k = 0; k < 6; k++) {
    const th = k / 6 * Math.PI * 2 + 0.3, p0 = P(Math.cos(th) * r * 0.34, Math.sin(th) * r * 0.34), p1 = P(Math.cos(th) * r * 0.92, Math.sin(th) * r * 0.92);
    ctx.beginPath(); ctx.moveTo(...p0); ctx.lineTo(...p1); ctx.stroke();
  }
  ctx.fillStyle = '#6f6d69'; ctx.beginPath(); ctx.ellipse(0, -thick * 0.2, r * 0.14, r * 0.14 * Math.max(s, 0.35), 0, 0, Math.PI * 2); ctx.fill();
  // cockpit tube on the starboard side
  const ck = [[r * 0.72, -r * 0.2], [r * 1.08, -r * 0.82], [r * 1.26, -r * 0.72], [r * 0.94, -r * 0.05]].map(([x, y]) => P(x, y, -thick * 0.15));
  ctx.fillStyle = '#d9d7d1';
  ctx.beginPath(); ck.forEach((p, i) => (i ? ctx.lineTo(...p) : ctx.moveTo(...p))); ctx.closePath(); ctx.fill(); ctx.stroke();
  const win = P(r * 1.17, -r * 0.79, -thick * 0.15);
  ctx.fillStyle = '#2a3442'; ctx.beginPath(); ctx.ellipse(win[0], win[1], r * 0.1, r * 0.1 * Math.max(s, 0.5), 0, 0, Math.PI * 2); ctx.fill();
  // radar dish, standing up a little from the hull
  const dish = P(-r * 0.45, -r * 0.25, -thick * 0.6);
  ctx.fillStyle = '#c9c7c1'; ctx.beginPath(); ctx.ellipse(dish[0], dish[1], r * 0.16, r * 0.11 * Math.max(s, 0.6), 0.5 * s, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  // the drive strip along the back of the rim
  ctx.strokeStyle = `rgba(150,215,255,${0.85 + 0.15 * Math.sin(t * 12)})`; ctx.lineWidth = Math.max(1, r * 0.1); ctx.lineCap = 'round';
  ctx.beginPath();
  for (let i = 0; i <= 12; i++) { const th = Math.PI / 2 - 0.75 + 1.5 * i / 12, p = P(Math.cos(th) * r * 0.93, Math.sin(th) * r * 0.93, thick * 0.5); i ? ctx.lineTo(...p) : ctx.moveTo(...p); }
  ctx.stroke();
  ctx.restore();
}

function drawDeathStar(ctx, R, t, s) {
  // a grey battle station: latitude bands, the equatorial trench and the superlaser dish, in perspective
  ctx.save();
  const c = Math.sqrt(1 - s * s); // cos of the elevation
  const g = ctx.createRadialGradient(-R * 0.35, -R * 0.35, R * 0.1, 0, 0, R);
  g.addColorStop(0, '#c9ccd1'); g.addColorStop(0.7, '#7c8088'); g.addColorStop(1, '#3e4148');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.save();
  ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.clip();
  ctx.strokeStyle = 'rgba(40,42,48,0.35)'; ctx.lineWidth = Math.max(0.4, R * 0.02);
  // latitude circles: centre moves with the elevation, height opens up toward the top view
  for (const lat of [-1.1, -0.7, -0.35, 0.35, 0.7, 1.1]) {
    const rx = R * Math.cos(lat), cy = -R * Math.sin(lat) * c, ry = Math.max(0.3, rx * s);
    ctx.beginPath(); ctx.ellipse(0, cy, rx, ry, 0, 0, Math.PI * 2); ctx.stroke();
  }
  // meridians, turning slowly
  const rot = (t * 0.05) % 1;
  for (let k = 0; k < 8; k++) { const x = Math.sin((k / 8 + rot) * Math.PI * 2) * R; ctx.beginPath(); ctx.ellipse(0, 0, Math.abs(x), R, 0, 0, Math.PI * 2); ctx.globalAlpha = 0.5 + 0.5 * c; ctx.stroke(); ctx.globalAlpha = 1; }
  // the trench: the near half of the equator
  ctx.strokeStyle = 'rgba(25,27,32,0.9)'; ctx.lineWidth = Math.max(1, R * 0.07);
  ctx.beginPath(); ctx.ellipse(0, 0, R, Math.max(0.5, R * s), 0, 0, Math.PI); ctx.stroke();
  // superlaser dish on the northern hemisphere, facing a little to the left of the camera
  const lat = 0.55, lon = -0.55;
  const px = Math.cos(lat) * Math.sin(lon), py = Math.sin(lat), pz = Math.cos(lat) * Math.cos(lon);
  const vy = py * c - pz * s, vz = pz * c + py * s; // rotate the point by the camera elevation
  if (vz > 0) {
    const dx = R * px, dy = -R * vy, dr = R * 0.27;
    ctx.save(); ctx.translate(dx, dy);
    const ang = Math.atan2(-vy, px); ctx.rotate(ang); ctx.scale(Math.max(0.25, vz), 1); ctx.rotate(-ang); // foreshortened toward the rim
    const dg = ctx.createRadialGradient(dr * 0.3, dr * 0.3, dr * 0.1, 0, 0, dr);
    dg.addColorStop(0, '#9da1a8'); dg.addColorStop(1, '#4b4e55');
    ctx.fillStyle = dg; ctx.beginPath(); ctx.arc(0, 0, dr, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = 'rgba(30,32,36,0.7)'; ctx.lineWidth = Math.max(0.5, R * 0.025);
    ctx.beginPath(); ctx.arc(0, 0, dr * 0.55, 0, Math.PI * 2); ctx.stroke();
    glow(ctx, 0, 0, dr * 0.5, '120,255,140', 0.35 + 0.3 * Math.max(0, Math.sin(t * 1.3)));
    ctx.restore();
  }
  ctx.restore();
  // terminator shading
  const sh = ctx.createLinearGradient(-R, -R, R, R);
  sh.addColorStop(0.45, 'rgba(0,0,0,0)'); sh.addColorStop(1, 'rgba(0,0,0,0.55)');
  ctx.fillStyle = sh; ctx.beginPath(); ctx.arc(0, 0, R, 0, Math.PI * 2); ctx.fill();
  ctx.restore();
}
