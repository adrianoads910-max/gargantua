'use strict';
// One camera for both layers: the WebGL black hole and the 2D canvas with planets use the same
// position, basis and field of view, so a planet drawn at (x, y, z) sits where the shader expects it.

const V = {
  add: (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  mul: (a, s) => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  len: a => Math.hypot(a[0], a[1], a[2]),
  norm: a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; },
  lerp: (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t],
};

const FOV = 30 * Math.PI / 180; // a long lens: big black hole, flat orbits, like the film

function createCamera() {
  const cam = {
    target: [0, 0, 0], yaw: 0.35, pitch: 0.15, dist: 60,
    want: { target: [0, 0, 0], dist: 80 },
    tan: Math.tan(FOV / 2), W: 1, H: 1,
    pos: [0, 0, 0], fw: [0, 0, -1], right: [1, 0, 0], up: [0, 1, 0],
  };
  cam.update = function (dt) {
    const k = 1 - Math.exp(-dt * 2.6);
    cam.target = V.lerp(cam.target, cam.want.target, k);
    cam.dist += (cam.want.dist - cam.dist) * k;
    const cp = Math.cos(cam.pitch);
    cam.pos = V.add(cam.target, V.mul([cp * Math.sin(cam.yaw), Math.sin(cam.pitch), cp * Math.cos(cam.yaw)], cam.dist));
    cam.fw = V.norm(V.sub(cam.target, cam.pos));
    cam.right = V.norm(V.cross(cam.fw, [0, 1, 0]));
    cam.up = V.cross(cam.right, cam.fw);
  };
  // world point -> screen pixels (CSS) + depth; null when behind the camera
  cam.project = function (p) {
    const rel = V.sub(p, cam.pos);
    const z = V.dot(rel, cam.fw);
    if (z < 0.05) return null;
    const h = cam.H / 2, s = h / (z * cam.tan);
    return { x: cam.W / 2 + V.dot(rel, cam.right) * s, y: h - V.dot(rel, cam.up) * s, z, s };
  };
  return cam;
}
