'use strict';
// Procedural planet surfaces, painted once into small offscreen canvases (equirectangular strips
// that scroll sideways to make the planet turn).

function strHash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) { return () => { seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

function valueNoise(rand, gw, gh) {
  const g = Array.from({ length: gw * gh }, rand);
  const at = (x, y) => g[((y % gh + gh) % gh) * gw + ((x % gw + gw) % gw)];
  return (x, y) => { // x, y in grid units, wraps horizontally
    const xi = Math.floor(x), yi = Math.floor(y), fx = x - xi, fy = y - yi;
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const a = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * sx;
    const b = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * sx;
    return a + (b - a) * sy;
  };
}

// name, palette stops (value 0..1 -> rgb), banding (0 = blotchy, 1 = gas bands), atmosphere color
const WORLDS = [
  { kind: 'oceano', label: 'mundo oceânico (Miller)', stops: [[0, [10, 40, 70]], [0.55, [30, 90, 130]], [0.7, [120, 170, 190]], [0.78, [225, 235, 240]], [1, [255, 255, 255]]], band: 0.15, atmo: '120,190,255' },
  { kind: 'gelo', label: 'mundo de gelo (Mann)', stops: [[0, [120, 130, 145]], [0.45, [190, 200, 210]], [0.7, [235, 240, 245]], [1, [255, 255, 255]]], band: 0.05, atmo: '200,225,255' },
  { kind: 'deserto', label: 'mundo rochoso (Edmunds)', stops: [[0, [90, 50, 30]], [0.4, [160, 100, 60]], [0.7, [205, 160, 110]], [1, [235, 205, 160]]], band: 0.1, atmo: '255,200,150' },
  { kind: 'vulcânico', label: 'mundo vulcânico', stops: [[0, [25, 15, 15]], [0.55, [60, 35, 30]], [0.75, [120, 40, 20]], [0.85, [255, 120, 40]], [1, [255, 220, 120]]], band: 0, atmo: '255,120,60' },
  { kind: 'floresta', label: 'mundo verde', stops: [[0, [15, 45, 60]], [0.45, [25, 70, 90]], [0.5, [60, 100, 50]], [0.75, [110, 130, 70]], [1, [220, 225, 210]]], band: 0.1, atmo: '150,230,200' },
  { kind: 'gasoso', label: 'gigante de metano', stops: [[0, [30, 70, 110]], [0.5, [70, 140, 170]], [1, [170, 220, 230]]], band: 0.9, atmo: '140,210,255' },
  { kind: 'ferrugem', label: 'mundo de ferrugem', stops: [[0, [60, 25, 20]], [0.5, [140, 60, 40]], [0.8, [190, 110, 80]], [1, [230, 190, 160]]], band: 0.25, atmo: '255,160,120' },
];

function colorAt(stops, v) {
  v = Math.max(0, Math.min(1, v));
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i], t = (v - a) / (b - a || 1);
      return [ca[0] + (cb[0] - ca[0]) * t, ca[1] + (cb[1] - ca[1]) * t, ca[2] + (cb[2] - ca[2]) * t];
    }
  }
  return stops[stops.length - 1][1];
}

function paint(w, h, fn) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const x = c.getContext('2d'), img = x.createImageData(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const [r, g, b] = fn(i, j), k = (j * w + i) * 4;
    img.data[k] = r; img.data[k + 1] = g; img.data[k + 2] = b; img.data[k + 3] = 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

// the kind of world comes from `family` (the repository: its sessions look related), the surface from `name`
function planetTexture(name, family) {
  const seed = strHash(name), rand = rng(seed);
  const world = WORLDS[strHash(family || name) % WORLDS.length];
  const W = 256, H = 128;
  const n1 = valueNoise(rand, 8, 4), n2 = valueNoise(rand, 16, 8), n3 = valueNoise(rand, 32, 16), n4 = valueNoise(rand, 64, 32);
  const tex = paint(W, H, (i, j) => {
    const u = i / W, v = j / H;
    const warp = n2(u * 16, v * 8) * 0.6;
    let val = n1(u * 8 + warp, v * 4) * 0.5 + n2(u * 16, v * 8) * 0.25 + n3(u * 32, v * 16) * 0.15 + n4(u * 64, v * 32) * 0.1;
    if (world.band) val = val * (1 - world.band) + world.band * (0.5 + 0.5 * Math.sin(v * 26 + warp * 6 + n1(u * 8, v * 4) * 3));
    const lat = Math.abs(v - 0.5) * 2;
    if (world.kind !== 'vulcânico' && world.kind !== 'gasoso') val += Math.max(0, lat - 0.78) * 2.2; // polar caps
    return colorAt(world.stops, val);
  });
  return { tex, world, clouds: cloudTexture(name, world) };
}

// A cloud layer (rgba) that turns at its own speed over the surface: the drift between the two is what
// makes a planet read as spinning. Gas worlds get streaks, volcanic ones ash, the rest white weather.
function cloudTexture(name, world) {
  const rand = rng(strHash(name + ':clouds')), W = 256, H = 128;
  const n1 = valueNoise(rand, 8, 4), n2 = valueNoise(rand, 24, 12), n3 = valueNoise(rand, 64, 32);
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d'), img = x.createImageData(W, H);
  const gas = world.kind === 'gasoso', ash = world.kind === 'vulcânico';
  const col = ash ? [70, 45, 40] : gas ? [225, 245, 250] : [250, 252, 255];
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const u = i / W, v = j / H;
    let d = gas
      ? n2(u * 24 * 0.35, v * 12 * 3) * 0.6 + n3(u * 64, v * 32) * 0.4               // stretched along the bands
      : n1(u * 8 + n2(u * 24, v * 12) * 0.8, v * 4) * 0.6 + n2(u * 24, v * 12) * 0.32 + n3(u * 64, v * 32) * 0.08;
    const a = Math.max(0, Math.min(1, (d - (gas ? 0.48 : 0.5)) * 2.2)) * (ash ? 0.7 : 0.8); // a soft edge: no blocky cloud tops
    const k = (j * W + i) * 4;
    img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = a * 255;
  }
  x.putImageData(img, 0, 0);
  return c;
}

function moonTexture(seed) {
  const rand = rng(seed), n = valueNoise(rand, 12, 6), m = valueNoise(rand, 40, 20);
  const g = 120 + (seed % 60);
  return paint(64, 32, (i, j) => {
    const v = n(i / 64 * 12, j / 32 * 6) * 0.7 + m(i / 64 * 40, j / 32 * 20) * 0.3;
    const c = g * (0.6 + v * 0.7);
    return [c, c * 0.97, c * 0.93];
  });
}
