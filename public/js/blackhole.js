'use strict';
// Gargantua: a ray-marched Schwarzschild black hole (units: Schwarzschild radius = 1).
// Every pixel's ray is bent by the hole; where it crosses the disk plane it picks up the accretion
// disk, so the far side of the disk shows above and below the shadow, as in the film.

const BH = { DISK_IN: 2.6, DISK_OUT: 16, SHADOW: 2.6 };

const VERT = `attribute vec2 p; void main(){ gl_Position = vec4(p, 0., 1.); }`;


const COMMON = `
precision highp float;
uniform vec2 uRes; uniform float uTime; uniform float uTan;
uniform vec3 uCam, uFw, uRight, uUp;

float hash3(vec3 p){ return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), f.x), f.y);
}
float fbm(vec2 p){ float v = 0., a = .5; for (int i = 0; i < 4; i++) { v += a * noise(p); p = p * 2.03 + 7.1; a *= .5; } return v; }

// a patch of sky around direction c: coordinates on its tangent plane (x right, y up); w = how much d faces c
vec2 patchUV(vec3 d, vec3 c, out float w){
  vec3 e1 = normalize(cross(c, vec3(0., 1., 0.)));
  vec3 e2 = cross(e1, c);
  w = dot(d, c);
  return vec2(dot(d, e1), dot(d, e2)) / max(w, 1e-3);
}

// a distant emission nebula: a two-tone fbm cloud with a ragged edge
vec3 nebula(vec3 d, vec3 c, float size, vec3 c1, vec3 c2, float seed){
  float w; vec2 p = patchUV(d, normalize(c), w) / size;
  float r = length(p);
  if (w < .3 || r > 1.7) return vec3(0.);
  float n = fbm(p * 2.2 + seed), m = fbm(p * 4.7 - seed * .7);
  float shape = smoothstep(1.45, .15, r + (n - .5) * 1.);
  float dens = pow(max(0., n * .85 + m * .45 - .38), 1.5) * shape;
  return mix(c1, c2, smoothstep(.35, .8, m)) * dens;
}

// The Pillars of Creation (Eagle Nebula, M16), after the Hubble image: three dark columns of dust against
// glowing teal and gold gas, lit at their rims and tips, with gas boiling off the tops.
// Returns colour (rgb) and how much of the sky behind it is hidden (a).
vec4 pillars(vec3 d){
  float w; vec2 q = patchUV(d, normalize(vec3(-.46, .07, -.89)), w) / .056;
  if (w < .5 || dot(q, q) > 12.) return vec4(0.);
  float region = smoothstep(3.2, 1.2, length(q * vec2(.9, .75)));
  float cl = fbm(q * 2.4 + 5.), cl2 = fbm(q * 6.5 - 3.);
  // the glowing HII region behind: teal low, gold high, streaky
  vec3 bg = mix(vec3(.07, .26, .28), vec3(.62, .45, .22), smoothstep(-.8, 1.4, q.y + (cl - .5) * 1.3));
  bg *= (.2 + cl * .85 + cl2 * .3) * .55 * region;
  float edge = (fbm(q * 3.5 + 1.) - .5) * .22 + (fbm(q * 11. - 4.) - .5) * .09;   // lumpy, ragged dust edges
  float a = 0., rim = 0., tip = 0., shade = 0.;
  for (int i = 0; i < 3; i++) {
    float fi = float(i);
    float x0 = fi == 0. ? -.55 : fi == 1. ? .08 : .58;
    float top = fi == 0. ? .9 : fi == 1. ? .2 : -.12;
    float wd = fi == 0. ? .17 : fi == 1. ? .12 : .135;
    float tilt = fi == 0. ? .24 : fi == 1. ? .1 : -.06;
    float base = -1.9, h = clamp((q.y - base) / (top - base), 0., 1.);
    float cx = x0 + tilt * (q.y - base) * .45 + (fbm(vec2(q.y * 2.2, fi * 7.)) - .5) * .16;
    // wide at the foot, narrowing upward, with a rounded head
    float wy = wd * (1. - .3 * h + .9 * (1. - smoothstep(0., .32, h)) + .45 * smoothstep(.78, .94, h) * (1. - smoothstep(.94, 1.02, h)));
    float dist = abs(q.x - cx) - wy + edge;
    float topcut = smoothstep(top + .07, top - .05, q.y + edge * 1.5);
    float inside = smoothstep(.03, -.04, dist) * topcut;
    // light from the young stars above and to the right: the right flank and the top are brighter
    float side = clamp((q.x - cx) / max(wy, .01), -1., 1.) * .5 + .5;
    shade = max(shade, inside * (.35 + .65 * side) * (.6 + .4 * h));
    a = max(a, inside);
    rim = max(rim, smoothstep(-.07, 0., dist) * inside * h);                              // lit edges, brighter higher up
    tip = max(tip, smoothstep(top - .18, top, q.y) * inside);                              // the lit heads
    tip = max(tip, exp(-pow((q.x - cx) / (wy * .9), 2.)) * smoothstep(top + .32, top, q.y) * step(top, q.y) * .4); // gas boiling off
  }
  // the dark cloud the pillars rise from: their feet dissolve into it
  float floor_ = smoothstep(-.7, -1.6, q.y + (cl - .5) * .9) * region; // fades with the glow: no round edge
  a = max(a, floor_ * .6 * region);
  vec3 dust = mix(vec3(.05, .03, .02), vec3(.32, .17, .08), shade) * (.55 + cl2 * .8);
  vec3 lit = vec3(1., .64, .32);
  float fadeOut = smoothstep(3.4, 2.1, length(q)); // nothing ends on a hard line: it all thins out before the patch edge
  vec3 col = (mix(bg, dust, a) + lit * (rim * .22 + tip * .45) * region) * fadeOut;
  return vec4(col, a * .93 * region * fadeOut);
}

vec3 sky(vec3 d){
  vec3 col = vec3(0.);
  for (int l = 0; l < 3; l++) {
    float sc = 70. + float(l) * 85.;
    vec3 c = d * sc, id = floor(c), f = fract(c) - .5;
    float h = hash3(id + float(l) * 19.7);
    if (h > .982) {
      float b = (h - .982) / .018;
      float tw = .75 + .25 * sin(uTime * (1. + 3. * h) + h * 40.);
      col += smoothstep(.32, 0., length(f)) * b * b * tw * mix(vec3(1., .82, .62), vec3(.68, .8, 1.), hash3(id + 3.1)) * 1.6;
    }
  }
  float lon = atan(d.z, d.x), lat = asin(clamp(d.y, -1., 1.));
  float n = fbm(vec2(lon * 1.7, lat * 3.1) + 11.);
  float band = exp(-pow((lat - .35 * sin(lon * .7)) * 2.4, 2.));
  col += vec3(.16, .10, .07) * pow(n, 2.6) * band * 1.4 + vec3(.03, .035, .05) * n;
  // distant nebulae, in the colours emission nebulae really have
  col += nebula(d, vec3(-.06, -.25, -1.), .17, vec3(.55, .10, .22), vec3(.98, .45, .58), 1.3) * .5;   // hydrogen-alpha rose
  col += nebula(d, vec3(-.2, .07, -.98), .11, vec3(.04, .32, .34), vec3(.38, .86, .78), 2.9) * .45;   // oxygen teal
  col += nebula(d, vec3(.6, .1, .8), .26, vec3(.07, .22, .48), vec3(.38, .62, .95), 4.1) * .5;       // blue reflection
  col += nebula(d, vec3(-.92, .22, .3), .2, vec3(.30, .09, .45), vec3(.78, .48, .98), 7.7) * .5;     // violet
  col += nebula(d, vec3(.82, -.28, -.42), .21, vec3(.45, .24, .07), vec3(.98, .72, .36), 5.5) * .45; // gold
  vec4 pc = pillars(d);
  col = col * (1. - pc.a) + pc.rgb;
  return col;
}

vec3 disk(vec3 p, vec3 rd, out float a){
  float r = length(p.xz);
  a = 0.;
  if (r < ${BH.DISK_IN.toFixed(2)} || r > ${BH.DISK_OUT.toFixed(2)}) return vec3(0.);
  float x = (r - ${BH.DISK_IN.toFixed(2)}) / ${(BH.DISK_OUT - BH.DISK_IN).toFixed(2)};
  float ang = atan(p.z, p.x);
  float t = ang + uTime * 1.1 / pow(r, 1.5) * 3.;
  float s = fbm(vec2(r * 2.6, t * 2.2)) * .7 + fbm(vec2(r * 9., t * 5.)) * .45;
  float fall = smoothstep(0., .05, x) * (1. - smoothstep(.45, 1., x));
  float dens = fall * (.35 + s);
  vec3 c = mix(vec3(1., .97, .9), vec3(1., .66, .33), smoothstep(0., .3, x));
  c = mix(c, vec3(.78, .33, .13), smoothstep(.3, .85, x));
  float inten = 4.2 * pow(1. - x, 2.2) + .18;
  vec3 v = normalize(vec3(-p.z, 0., p.x));
  float dop = 1. + .42 * dot(v, -rd);
  a = clamp(dens * 1.15 * (1. - .88 * smoothstep(.15, .85, x)), 0., 1.);
  return c * inten * dens * dop * dop * dop;
}
`;

// The hole, the disk and every ray it bends. Alpha is an occlusion mask: 1 where the shadow, the disk or
// noticeably lensed sky is, 0 where light passes almost straight, so planets drawn on the layer below
// show through only where nothing of Gargantua is in front of them. Premultiplied: colour <= alpha.
const FRAG = COMMON + `
void main(){
  vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y * 2.;
  vec3 rd = normalize(uFw + (uv.x * uRight + uv.y * uUp) * uTan);
  vec3 pos = uCam, vel = rd;
  vec3 hv = cross(pos, vel); float h2 = dot(hv, hv);
  vec3 col = vec3(0.); float T = 1.; bool hole = false;
  for (int i = 0; i < 300; i++) {
    float r = length(pos);
    if (r < 1.) { hole = true; break; }
    if (r > ${(BH.DISK_OUT + 4).toFixed(1)} && dot(pos, vel) > 0.) break;
    float dt = clamp(min(.07 * r, .028 * r * r), .02, 4.);
    vel += -1.5 * h2 * pos / pow(r, 5.) * dt;
    vec3 np = pos + vel * dt;
    float rr = length(np.xz); // the haze around the disk that makes it glow
    col += T * vec3(1., .55, .25) * .005 * dt * exp(-abs(np.y) * 3.) * smoothstep(${BH.DISK_OUT.toFixed(1)}, 3., rr) * step(${BH.DISK_IN.toFixed(2)}, rr);
    if (pos.y * np.y < 0.) {
      vec3 p = mix(pos, np, pos.y / (pos.y - np.y));
      float a; vec3 c = disk(p, normalize(vel), a);
      col += T * c * a; T *= 1. - a;
      if (T < .02) break;
    }
    pos = np;
  }
  float alpha = 1.;
  if (!hole) {
    vec3 out_ = normalize(vel);
    float bend = 1. - dot(rd, out_);                 // ~ angle^2 / 2
    // bending falls off only as ~2/b, so a weak bend must not count: only where light really curves
    // (~0.2 rad and up: the disk and the photon ring region) does Gargantua own the pixel and hide what is behind
    float lens = smoothstep(.02, .12, bend);
    col += T * lens * sky(out_);
    alpha = 1. - T * (1. - lens);
  }
  col = 1. - exp(-col * 1.25);
  col = pow(col, vec3(.92, .95, 1.));
  alpha = max(alpha, max(col.r, max(col.g, col.b)));
  gl_FragColor = vec4(col, alpha);
}`;

// The unbent sky, under everything (cheap: no ray marching).
const FRAG_SKY = COMMON + `
void main(){
  vec2 uv = (gl_FragCoord.xy - .5 * uRes) / uRes.y * 2.;
  vec3 rd = normalize(uFw + (uv.x * uRight + uv.y * uUp) * uTan);
  vec3 col = 1. - exp(-sky(rd) * 1.25);
  gl_FragColor = vec4(pow(col, vec3(.92, .95, 1.)), 1.);
}`;

function program(canvas, frag, alpha) {
  const gl = canvas.getContext('webgl', { antialias: false, alpha, premultipliedAlpha: true, preserveDrawingBuffer: false });
  if (!gl) return null;
  const sh = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src); gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
    return s;
  };
  const prog = gl.createProgram();
  gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, frag));
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
  gl.useProgram(prog);
  const buf = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'p');
  gl.enableVertexAttribArray(loc);
  gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const u = {};
  for (const n of ['uRes', 'uTime', 'uTan', 'uCam', 'uFw', 'uRight', 'uUp']) u[n] = gl.getUniformLocation(prog, n);
  return function render(cam, time) {
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(u.uRes, canvas.width, canvas.height);
    gl.uniform1f(u.uTime, time);
    gl.uniform1f(u.uTan, cam.tan);
    gl.uniform3fv(u.uCam, cam.pos);
    gl.uniform3fv(u.uFw, cam.fw);
    gl.uniform3fv(u.uRight, cam.right);
    gl.uniform3fv(u.uUp, cam.up);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  };
}

function createBlackHole(canvas, skyCanvas) {
  const hole = program(canvas, FRAG, true), sky = program(skyCanvas, FRAG_SKY, false);
  if (!hole || !sky) return null;
  return { render(cam, time) { sky(cam, time); hole(cam, time); } };
}
