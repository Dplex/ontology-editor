// 가이드 그림 0: BIM 파일 하나로 DT 온톨로지가 어디까지 되나를 계단식 진열대로 보인다(docs/bim-to-dt-ontology.md 3.5).
// 계단 한 칸이 등급 하나이고, 칸마다 그 등급이 온톨로지에 보태는 것이 놓여 있다. 파일을 고르면 옆 레일의 승강기가
// 그 파일의 가장 높은 등급 칸까지 올라가고, 파일이 채운 칸에 불이 들어온다. 맨 위 칸은 뚜껑이 덮여 있고 BIM 이 아니라
// 진열대 밖의 IDF·BAS 함에서 케이블로 받는다.
// 다시 만들려면 `node scripts/guide/figures/grade/build.mjs` 를 돌린다. public/guide/fig/grade.html(밝은 판)과 grade-dark.html 이 나온다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import { kitScript } from "../../anatomy/scripts/inline-kit.mjs";
import { GRADES, REQUIRED, SAMPLES, readoutOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "..", "public", "guide", "fig");

const WIDTH = 600;
const HEIGHT = 430;

// 진열대(단위 ≈ px). 칸 i 는 앞 모서리가 y = -SY·i, 깊이 TD, 바닥이 z = Z0 + SZ·i 다. 칸 사이 6 은 다리가 지나는 틈이다.
const TIERS = 6;
const W = 150;
const TD = 34;
const SY = 40;
const SZ = 20;
const Z0 = 16;
const TH = 3.5;
const yFront = (i) => -SY * i;
const yBack = (i) => -SY * i - TD;
const yMid = (i) => -SY * i - TD / 2;
const zBot = (i) => Z0 + SZ * i;
const zTop = (i) => Z0 + SZ * i + TH;
const trayPlan = (i) => ({ x: 0, y: yBack(i), w: W, d: TD, r: 2 });

// 승강기 레일: 진열대 오른쪽(+x)에 비스듬히 놓인다. 칸 i 의 승강장에서 레일 윗면은 칸 윗면보다 4 낮다.
const RAIL = { x0: W + 8, x1: W + 11, h: 3, from: -0.35, to: 5.35 };
const railY = (t) => yMid(0) - SY * t;
const railZ = (t) => zTop(0) - 4 + SZ * t;
const RAIL_POSTS = [0, 2.5, 5];
const CAR = { x0: W + 11, x1: W + 18, hy: 5, below: 6, above: 5 };

const BASE = { x: -12, y: -250, w: W + 40, d: 288, r: 6 };
const BASE_H = 6;
const FOOT_H = 5;
const HOLDER = { x: 18, y: 12, w: 116, d: 12, r: 1.5 };
const HOLDER_H = 4;
const TOKEN = { w: 12, d: 5, h: 15, lift: 7 };
const tokenX = (n) => 30 + 23 * n;
const LABEL = { x: 140, y: 13, w: 30, d: 11, r: 1.2 };
const RULER = { x: W + 22, y: -228, w: 5, d: 222, r: 1 };

// 진열대 밖의 IDF·BAS 함. 받침판 위가 아니라 제 받침 위에 선다.
const CAB = { x: W + 44, y: -252, w: 30, d: 26, r: 1.2 };
const CAB_PLINTH = k.insetPlan(CAB, -2);
const CAB_Z = [-BASE_H - FOOT_H + 4, 92];
const LID_H = 10;
const JACK = [W - 14, yMid(5)];

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [0, yBack(5), zTop(5) + LID_H],
    [W, yBack(5), zTop(5) + LID_H],
    [CAB.x, CAB.y, CAB_Z[1]],
    [CAB.x, CAB.y + CAB.d, -BASE_H - FOOT_H],
    [CAB.x, CAB.y, 142],
    [RAIL.x1, railY(RAIL.to), railZ(RAIL.to) + CAR.above + 2],
  ],
  WIDTH,
  HEIGHT,
  { pad: 12, azimuth: 58, elevation: 36 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const slab = (plan, z, h, style = {}, steps = 3, bevel = 0) => S(k.slabOf(plan, z, h, P, steps, bevel), style);
const box = (x, y, w, d, r = 0.4) => ({ x, y, w, d, r });
const faceRect = (corners) => `M${corners.map((p) => at(p).map((v) => v.toFixed(1)).join(" ")).join("L")}Z`;
const { sinA, cosA } = k.cameraOf(P);

// 기울어진 각재: 바닥면이 수평이 아니라서 kit 의 기둥 모양 입체로는 못 짓는다. 위·+x 옆·앞 끝 세 면이 보인다.
function beam(x0, x1, [yF, zF], [yB, zB], h) {
  const c = (x, y, z) => at([x, y, z]);
  const top = [c(x0, yF, zF), c(x1, yF, zF), c(x1, yB, zB), c(x0, yB, zB)];
  const side = [c(x1, yF, zF), c(x1, yB, zB), c(x1, yB, zB - h), c(x1, yF, zF - h)];
  const end = [c(x0, yF, zF), c(x1, yF, zF), c(x1, yF, zF - h), c(x0, yF, zF - h)];
  const all = [...top, c(x0, yF, zF - h), c(x1, yF, zF - h), c(x0, yB, zB - h), c(x1, yB, zB - h)];
  const shadeOf = ([nx, ny]) => Math.min(3, Math.max(0, Math.floor(((nx * -sinA + ny * cosA + 1) / 2) * 4)));
  const shades = ["", "", "", ""];
  shades[shadeOf([1, 0])] += k.pathOf(side, true);
  shades[shadeOf([0, 1])] += k.pathOf(end, true);
  const hull = convexHull(all);
  return { fill: k.pathOf(hull, true), outline: k.pathOf(hull, true), top: k.pathOf(top, true), shades, crease: k.pathOf([top[0], top[1], top[2]]) };
}
function convexHull(points) {
  const p = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [], upper = [];
  for (const q of p) { while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], q) <= 0) lower.pop(); lower.push(q); }
  for (const q of p.reverse()) { while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], q) <= 0) upper.pop(); upper.push(q); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

// --- 받침판 -------------------------------------------------------------------

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of k.corners(BASE, 20).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P))) {
    out.push(S(k.cylinder(x, y, 7, -BASE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(slab(BASE, -BASE_H, BASE_H, { tone: "lo" }, 8, 1.6));
  out.push(L(k.planOutline(k.insetPlan(BASE, 5), 0, P), { tone: "faint" }));
  const screws = k.corners(BASE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  return out.join("");
}

// 레일 옆 눈금자: 큰 눈금이 칸마다 하나, 승강장 자리에 선다.
function ruler() {
  const out = [slab(RULER, 0, 0.6, { tone: "lo", crease: "none" })];
  const t = k.topTicks(yMid(5), yMid(0), 8, 5, RULER.x, 0.6, [1.6, 3.2], P, "y");
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  return out.join("");
}

function labelPlate() {
  const out = [slab(LABEL, 0, 0.8, { tone: "mid", crease: "none" }, 4)];
  out.push(L(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P), { tone: "faint" }));
  [[0.7, 0], [0.45, 2.2], [0.58, 4.4]].forEach(([share, dy]) => {
    const x0 = LABEL.x + 5, y0 = LABEL.y + 3.2 + dy;
    out.push(L(k.lineOnTop([x0, y0], [x0 + (LABEL.w - 10) * share, y0], 0.8, P), { tone: "lo", free: true }));
  });
  out.push(D([at([LABEL.x + 2.6, LABEL.y + LABEL.d / 2, 0.8]), at([LABEL.x + LABEL.w - 2.6, LABEL.y + LABEL.d / 2, 0.8])], { size: 0.45 }));
  return out.join("");
}

// --- 칸 -----------------------------------------------------------------------

function legs(i) {
  const out = [];
  const z = zBot(i);
  for (const ly of [yBack(i) + 5, yFront(i) - 5]) {
    for (const x of [5, W - 5]) {
      out.push(S(k.cylinder(x, ly, 3, 0, 1.2, P, 18), { tone: "lo" }));
      out.push(S(k.cylinder(x, ly, 1.7, 1.2, z - 2.8, P, 14), { tone: "mid", crease: "none" }));
      out.push(S(k.cylinder(x, ly, 2.6, z - 1.6, 1.6, P, 18), { tone: "mid" }));
      if (x === 5) out.push(slab(box(6.7, ly - 1, W - 13.4, 2, 0.3), 6, 1.8, { tone: "mid", crease: "none" }, 2));
    }
  }
  return out.join("");
}

// 칸 몸통. back 은 짐보다 먼저, front 는 짐 다음에 그린다(앞 턱과 오른쪽 턱이 짐 앞에 있다).
function trayBack(i) {
  const p = trayPlan(i);
  const top = zTop(i);
  const pips = [];
  for (let n = 0; n < i; n++) pips.push(at([W - 6 - n * 3.2, yFront(i), zBot(i) + TH / 2]));
  const out = [`<g data-tray="${i}">${S(k.slabOf(p, zBot(i), TH, P, 3, 0.5), { tone: "mid", className: "gr-tray" })}</g>`];
  if (pips.length) out.push(D(pips, { size: 0.45, tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(p, 2.4), top, P, 3), { tone: "faint" }));
  out.push(D(k.corners(p, 1.2).map(([x, y]) => at([x, y, top])), { size: 0.4, tone: "lo" }));
  out.push(slab(box(0.6, yBack(i) + 0.6, W - 1.2, 1.4, 0.3), top, 1.8, { tone: "mid", crease: "none" }, 2));
  out.push(slab(box(0.6, yBack(i) + 2, 1.4, TD - 4, 0.3), top, 1.8, { tone: "mid", crease: "none" }, 2));
  return out.join("");
}
function trayFront(i) {
  const top = zTop(i);
  const out = [];
  out.push(slab(box(W - 2, yBack(i) + 2, 1.4, TD - 4, 0.3), top, 1.8, { tone: "mid", crease: "none" }, 2));
  out.push(slab(box(0.6, yFront(i) - 2, W - 1.2, 1.4, 0.3), top, 1.8, { tone: "mid", crease: "none" }, 2));
  // 승강장 받침: 칸 오른쪽 끝에 붙은 작은 혀. 승강기의 지침이 여기 닿는다.
  out.push(`<g data-tab="${i}">${slab(box(W, yMid(i) - 4, 3, 8, 0.4), top - 2.5, 2.5, { tone: "mid", className: "gr-tray" }, 2)}</g>`);
  return out.join("");
}

// 칸 안 좌표: lx 는 칸 왼쪽 끝에서, ly 는 칸 뒤 모서리에서 잰다.
const R = (i, lx, ly, w, d, r = 0.4) => box(lx, yBack(i) + ly, w, d, r);

const ROOMS = [
  { lx: 8, w: 56, tag: 36 },
  { lx: 64, w: 42, tag: 92 },
  { lx: 106, w: 36, tag: 128 },
];
const ROOM_Y = [5, 24];
const DEVICES = [
  { lx: 14, ly: 8, w: 18, d: 11, h: 8, room: 0, big: true },
  { lx: 46, ly: 9, w: 8, d: 7, h: 5, room: 0 },
  { lx: 80, ly: 9, w: 8, d: 7, h: 5, room: 1 },
  { lx: 118, ly: 9, w: 8, d: 7, h: 5, room: 2 },
];

// 등급 0: 벽·문·창으로 둘러싼 방 셋.
function load0(i) {
  const z = zTop(i);
  const out = [];
  for (const room of ROOMS) out.push(L(k.planOutline(R(i, room.lx + 1.6, ROOM_Y[0] + 1.6, room.w - 1.6, ROOM_Y[1] - 1.6, 0.6), z, P, 2), { tone: "faint" }));
  const wall = (lx, ly, w, d, h = 6, tone = "hi") => slab(R(i, lx, ly, w, d, 0.2), z, h, { tone, crease: "lo" }, 2);
  out.push(wall(8, 5, 134, 1.6));
  out.push(wall(8, 6.6, 1.6, 22.8));
  out.push(wall(63.2, 6.6, 1.6, 8.4), wall(63.2, 21, 1.6, 6.4));
  out.push(wall(105.2, 6.6, 1.6, 4.4), wall(105.2, 17, 1.6, 10.4));
  out.push(wall(140.4, 6.6, 1.6, 22.8));
  // 앞벽: 대기실 문(30~38), 회의실 창(76~92).
  out.push(wall(9.6, 27.4, 20.4, 1.6), wall(38, 27.4, 38, 1.6));
  out.push(wall(76, 27.4, 16, 1.6, 2.4));
  out.push(slab(R(i, 76, 27.9, 16, 0.6, 0.1), z + 2.4, 3.6, { tone: "mid", crease: "none" }, 1));
  out.push(wall(92, 27.4, 48.4, 1.6));
  return out.join("");
}

function device(i, dev, dz = 0) {
  const z = zTop(i) + dz;
  const p = R(i, dev.lx, dev.ly, dev.w, dev.d, 0.8);
  const out = [slab(k.insetPlan(p, -1.2), z, 0.8, { tone: "lo", crease: "none" }, 2)];
  const z1 = z + 0.8, z2 = z1 + dev.h;
  const yF = p.y + p.d;
  let inner = "";
  if (dev.big) {
    const slots = [];
    for (let n = 0; n < 4; n++) {
      const zz = z1 + 1.4 + n * 1.5;
      slots.push(faceRect([[p.x + 2, yF, zz], [p.x + p.w - 2, yF, zz], [p.x + p.w - 2, yF, zz + 0.6], [p.x + 2, yF, zz + 0.6]]));
    }
    inner = L(slots.join(""), { tone: "lo" });
  } else {
    inner = L(faceRect([[p.x + 1.4, yF, z1 + 1.2], [p.x + p.w - 1.4, yF, z1 + 1.2], [p.x + p.w - 1.4, yF, z2 - 1.2], [p.x + 1.4, yF, z2 - 1.2]]), { tone: "faint" });
  }
  out.push(S(k.slabOf(p, z1, dev.h, P, 3, 0.4), { tone: "hi", crease: "lo", inner }));
  const cx = p.x + p.w / 2, cy = p.y + p.d / 2;
  if (dev.big) out.push(D(k.dotGrid(p.x + 3, p.y + 2.6, 5, 3, 2.9, z2, P), { size: 0.35, tone: "lo" }));
  else out.push(L(k.ring(cx, cy, 2.2, z2, P, 16), { tone: "mid" }));
  // 배치점: 윗면 가운데의 점.
  out.push(D([at([cx, cy, z2])], { size: 0.55, tone: "hi" }));
  return out.join("");
}

// 등급 1: 설비와 그 좌표.
function load1(i) {
  return DEVICES.map((dev) => device(i, dev)).join("");
}

// 등급 2: 방 판 위에 놓인 설비가 끈으로 그 방의 이름표에 묶인다.
function load2(i) {
  const z = zTop(i);
  const out = [];
  for (const room of ROOMS) {
    const p = R(i, room.lx + 0.6, ROOM_Y[0], room.w - 1.2, ROOM_Y[1], 0.8);
    out.push(slab(p, z, 0.7, { tone: "mid", crease: "none" }, 2));
    out.push(L(k.planOutline(k.insetPlan(p, 1.4), z + 0.7, P, 2), { tone: "faint" }));
  }
  const tags = ROOMS.map((room) => {
    const p = R(i, room.tag, 21.5, 8, 4, 0.6);
    out.push(slab(p, z + 0.7, 1.4, { tone: "hi", crease: "lo" }, 2));
    return [p.x + p.w / 2, p.y + p.d / 2, z + 2.1];
  });
  for (const dev of DEVICES) out.push(device(i, dev, 0.7));
  for (const dev of DEVICES) {
    const top = [dev.lx + dev.w / 2 + (dev.big ? 5 : 0), yBack(i) + dev.ly + dev.d - 1.4, z + 0.7 + 0.8 + dev.h];
    out.push(k.wireSvg(at(top), at(tags[dev.room]), { tone: "mid", size: 0.75 }));
  }
  return out.join("");
}

// 등급 3·4: 설비를 잇는 덕트. 가지관은 본관 뒤쪽 면에 맞대고, 본관을 나중에 그려 맞댄 자리를 이음매로 덮는다.
const DUCT = { y0: 23, y1: 26, z0: 1, h: 3 };
const BRANCHES = [
  { x: 23, from: 19, src: true },
  { x: 50, from: 16 },
  { x: 84, from: 16 },
  { x: 122, from: 16 },
];
const TRUNK = [21.5, 123.5];
function ducts(i, arrows) {
  const z = zTop(i);
  const out = [];
  for (const lx of [36, 68, 102]) out.push(slab(R(i, lx - 1, DUCT.y0 - 0.4, 2, 3.8, 0.2), z, DUCT.z0, { tone: "lo", crease: "none" }, 1));
  for (const dev of DEVICES) out.push(device(i, dev));
  for (const b of BRANCHES) out.push(slab(R(i, b.x - 1.5, b.from, 3, DUCT.y0 - b.from, 0.2), z + DUCT.z0, DUCT.h, { tone: "hi", crease: "lo" }, 1));
  out.push(slab(R(i, TRUNK[0], DUCT.y0, TRUNK[1] - TRUNK[0], DUCT.y1 - DUCT.y0, 0.3), z + DUCT.z0, DUCT.h, { tone: "hi", crease: "lo" }, 2));
  const zt = z + DUCT.z0 + DUCT.h;
  for (const lx of [66, 104]) out.push(slab(R(i, lx, DUCT.y0 - 0.5, 2, 4, 0.2), z + DUCT.z0 - 0.5, DUCT.h + 1, { tone: "mid", crease: "none" }, 1));
  if (arrows) {
    const Y = (ly) => yBack(i) + ly;
    const vane = (ring) => S(k.extrude(ring, zt, 0.7, P), { tone: "hi", lit: true, crease: "none" });
    for (const lx of [37, 58, 94, 112]) out.push(vane([[lx - 1.6, Y(23.5)], [lx + 1.8, Y(24.5)], [lx - 1.6, Y(25.5)]]));
    out.push(vane([[22, Y(19.8)], [24, Y(19.8)], [23, Y(22.6)]]));
    for (const b of BRANCHES.slice(1)) out.push(vane([[b.x - 1, Y(21.4)], [b.x + 1, Y(21.4)], [b.x, Y(18.2)]]));
  }
  return out.join("");
}

// 등급 5: 뚜껑으로 덮인 칸. 안을 BIM 이 채우지 못한다. 위의 잭으로 바깥 케이블을 받는다.
function load5(i) {
  const z = zTop(i);
  const p = k.insetPlan(trayPlan(i), 3);
  const seam = L(k.sideSeam(p, z + 3, P, 3), { tone: "faint" });
  const out = [S(k.slabOf(p, z, LID_H, P, 3, 0.5), { tone: "mid", inner: seam })];
  const zt = z + LID_H;
  out.push(L(k.planOutline(k.insetPlan(p, 2.2), zt, P, 3), { tone: "faint" }));
  const screws = k.corners(p, 3.4);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 1.3, zt, P, 12)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, zt])), { size: 0.42 }));
  for (const lx of [40, 104]) out.push(slab(box(lx, p.y + p.d, 6, 1.2, 0.3), z + 3.4, 4.6, { tone: "mid" }, 1));
  out.push(S(k.cylinder(JACK[0], JACK[1], 2.6, zt, 1.2, P, 18), { tone: "lo" }));
  out.push(S(k.cylinder(JACK[0], JACK[1], 1.7, zt + 1.2, 1.4, P, 16), { tone: "mid" }));
  return out.join("");
}

const LOADS = [load0, load1, load2, (i) => ducts(i, false), (i) => ducts(i, true), load5];

function tier(i) {
  return `<g class="gr-tier" data-tier="${i}">${legs(i)}${trayBack(i)}<g class="gr-load">${LOADS[i](i)}</g>${trayFront(i)}</g>`;
}

// --- 바깥 함과 케이블 -----------------------------------------------------------

function cabinet() {
  const out = [`<path class="iso-halo" d="${k.haloOf(CAB_PLINTH, CAB_Z[0] - 3, 3, P)}"/>`];
  out.push(slab(CAB_PLINTH, CAB_Z[0] - 3, 3, { tone: "lo" }, 3, 0.4));
  const [z0, z1] = CAB_Z;
  const yF = CAB.y + CAB.d, xR = CAB.x + CAB.w;
  const door = faceRect([[CAB.x + 3, yF, z0 + 6], [xR - 3, yF, z0 + 6], [xR - 3, yF, z1 - 6], [CAB.x + 3, yF, z1 - 6]]);
  const vents = [];
  for (let n = 0; n < 6; n++) {
    const zz = z1 - 16 - n * 3;
    vents.push(faceRect([[CAB.x + 8, yF, zz], [xR - 8, yF, zz], [xR - 8, yF, zz + 1.1], [CAB.x + 8, yF, zz + 1.1]]));
  }
  const side = [];
  for (let n = 0; n < 3; n++) {
    const zz = z0 + 18 + n * 24;
    side.push(faceRect([[xR, CAB.y + 4, zz], [xR, yF - 4, zz], [xR, yF - 4, zz + 14], [xR, CAB.y + 4, zz + 14]]));
  }
  const inner = L(door, { tone: "lo" }) + L(vents.join(""), { tone: "faint" }) + L(side.join(""), { tone: "faint" });
  out.push(S(k.slabOf(CAB, z0, z1 - z0, P, 3, 0.6), { tone: "mid", inner }));
  out.push(D([at([xR - 6, yF, z0 + 14]), at([xR - 6, yF, z0 + 18]), at([xR - 6, yF, z0 + 22])], { size: 0.55, tone: "hi" }));
  out.push(L(k.planOutline(k.insetPlan(CAB, 2), z1, P, 3), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([CAB.x + 4.5, CAB.y + CAB.d - 5], z1, P, "x"), "IDF·BAS", { size: 4.6, tone: "lo" }));
  out.push(S(k.cylinder(CAB.x + 7, CAB.y + 7, 2.6, z1, 1.2, P, 18), { tone: "lo" }));
  out.push(S(k.cylinder(CAB.x + 7, CAB.y + 7, 1.7, z1 + 1.2, 1.4, P, 16), { tone: "mid" }));
  return out.join("");
}

function cable() {
  const from = [CAB.x + 7, CAB.y + 7, CAB_Z[1] + 2.6];
  const to = [JACK[0], JACK[1], zTop(5) + LID_H + 2.6];
  const hi = 142;
  const via = [[from[0], from[1], hi - 6], [from[0] - 6, from[1] + 2, hi], [to[0] + 6, to[1] - 2, hi], [to[0], to[1], hi - 6]];
  return `<g data-part="cable">${k.wireSvg(at(from), at(to), { via: via.map(at), tone: "mid", size: 0.9 })}</g>`;
}

// --- 승강기 -------------------------------------------------------------------

function rail() {
  const out = [];
  for (const t of RAIL_POSTS) {
    const x = (RAIL.x0 + RAIL.x1) / 2, y = railY(t);
    out.push(S(k.cylinder(x, y, 3, 0, 1.2, P, 18), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 1.4, 1.2, railZ(t) - RAIL.h - 1.2, P, 14), { tone: "mid", crease: "none" }));
  }
  out.push(S(beam(RAIL.x0, RAIL.x1, [railY(RAIL.from), railZ(RAIL.from)], [railY(RAIL.to), railZ(RAIL.to)], RAIL.h), { tone: "mid" }));
  // 끝막이: 레일 양 끝의 작은 고리판.
  for (const t of [RAIL.to - 0.04, RAIL.from + 0.04]) {
    out.push(slab(box(RAIL.x0 - 0.4, railY(t) - 1, RAIL.x1 - RAIL.x0 + 0.8, 2, 0.3), railZ(t) - 0.6, 2.4, { tone: "mid" }, 1));
  }
  return out.join("");
}

// 승강기는 칸 0 승강장에서 짓고 translateAlong 으로 옮긴다.
function carriage() {
  const y = railY(0), zr = railZ(0), top = zTop(0);
  const out = [];
  out.push(S(k.slabOf(box(W + 3, y - 2, CAR.x0 - W - 3, 4, 0.3), top - 2.5, 2.4, P, 1), { tone: "hi", lit: true }));
  const body = box(CAR.x0, y - CAR.hy, CAR.x1 - CAR.x0, CAR.hy * 2, 1);
  const z0 = zr - CAR.below, z1 = zr + CAR.above;
  const seam = L(k.sideSeam(body, zr - 1.5, P, 3), { tone: "faint" });
  out.push(S(k.slabOf(body, z0, z1 - z0, P, 3, 0.5), { tone: "hi", crease: "lo", inner: seam, className: "gr-pick" }));
  out.push(D([at([CAR.x1, y - 2.6, zr - 3.8]), at([CAR.x1, y + 2.6, zr - 3.8])], { size: 0.5, tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(body, 1.4), z1, P, 3), { tone: "faint" }));
  const kx = (CAR.x0 + CAR.x1) / 2 + 0.6;
  out.push(S(k.cylinder(kx, y + 1.6, 1.6, z1, 1.8, P, 16), { tone: "mid" }));
  return out.join("");
}

// --- 파일 토큰 ----------------------------------------------------------------

function holder() {
  const out = [slab(HOLDER, 0, HOLDER_H, { tone: "mid" }, 3, 0.5)];
  out.push(L(SAMPLES.map((_, n) => k.planOutline(box(tokenX(n) - TOKEN.w / 2 - 1, 14, TOKEN.w + 2, TOKEN.d + 2, 0.8), HOLDER_H, P, 2)).join(""), { tone: "lo" }));
  out.push(D(k.corners(HOLDER, 2.4).map(([x, y]) => at([x, y, HOLDER_H])), { size: 0.4 }));
  return out.join("");
}

function token(n) {
  const p = box(tokenX(n) - TOKEN.w / 2, 15, TOKEN.w, TOKEN.d, 0.8);
  const z0 = HOLDER_H, z1 = z0 + TOKEN.h;
  const yF = p.y + p.d;
  const win = faceRect([[p.x + 1.6, yF, z0 + 4], [p.x + p.w - 1.6, yF, z0 + 4], [p.x + p.w - 1.6, yF, z1 - 2], [p.x + 1.6, yF, z1 - 2]]);
  const out = [S(k.slabOf(p, z0, TOKEN.h, P, 2, 0.4), { tone: "hi", crease: "lo", inner: L(win, { tone: "faint" }), className: "gr-tok" })];
  const pips = [];
  for (let m = 0; m <= n; m++) pips.push(at([p.x + 2.6 + m * 1.7, yF, z0 + 2]));
  out.push(D(pips, { size: 0.42, tone: "mid" }));
  out.push(L(k.lineOnTop([p.x + 2, p.y + p.d / 2], [p.x + p.w - 2, p.y + p.d / 2], z1, P), { tone: "faint", free: true }));
  return `<g class="gr-token" data-sample="${SAMPLES[n].id}" data-n="${n}">${out.join("")}</g>`;
}

// --- 그림 ---------------------------------------------------------------------

const FIRST = SAMPLES[1];
const LABEL_TEXT =
  "받침판 위에 여섯 칸짜리 계단식 진열대가 있다. 아래 칸부터 차례로 벽으로 둘러싼 방, 설비 상자, 이름표에 묶인 설비, 덕트로 이은 설비, 덕트 위 흐름 화살표가 놓여 있고, 맨 위 칸은 뚜껑으로 덮여 진열대 밖의 IDF·BAS 함에서 케이블을 받는다. 앞쪽 거치대의 파일 토큰을 고르면 오른쪽 레일의 승강기가 그 파일의 가장 높은 등급 칸까지 오르고, 파일이 채운 칸에 불이 들어온다.";

const body = [
  base(),
  ruler(),
  labelPlate(),
  ...Array.from({ length: TIERS }, (_, n) => tier(TIERS - 1 - n)),
  rail(),
  `<g data-part="car">${carriage()}</g>`,
  cabinet(),
  cable(),
  holder(),
  ...SAMPLES.map((_, n) => `<g data-slot="token-${n}">${token(n)}</g>`),
];
const svg = k.figureSvg({ width: WIDTH, height: HEIGHT, label: LABEL_TEXT, body });

const CSS = `
.iso{--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace}
html{background:#f2f2ef}html:has(body[data-theme="dark"]){background:#0b0b0b}html[data-embed],html[data-embed]:has(body){background:transparent}html:has(body[data-theme="light"]),body[data-theme="light"]{color-scheme:light}body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.iso-page{width:100%;margin:0}
.iso-figure{margin:0}
.iso-plate{padding:46px 18px 44px}
.iso-plate-corner[data-corner="title"]{letter-spacing:.04em}
.iso-plate-corner[data-corner="hint"]{letter-spacing:.04em}
.gr-stage{outline:none;touch-action:pan-y}
.gr-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.gr-load{transition:opacity .5s ease}
.gr-tier:not([data-on]) .gr-load{opacity:.4}
.gr-tier[data-on="part"] .gr-load{opacity:.62}
.gr-tier :is([data-tray],[data-tab]) .iso-solid>*{transition:fill .5s ease,stroke .5s ease,stroke-width .5s ease}
.iso[data-theme="light"]{--anatomy-shade-0:#cfcfcc;--anatomy-shade-1:#d9d9d6;--anatomy-shade-2:#e3e3e0;--anatomy-shade-3:#ececea;--anatomy-mid:#76767c;--anatomy-lo:#a4a4a9;--anatomy-faint:#cdcdd0;--anatomy-muted:#6b6b70;
  --gr-on-top:#d4d4d8;--gr-on-side:#9c9ca2;--gr-on-edge:#000000;--gr-pick-top:#6e6e75;--gr-pick-side:#4a4a50;--gr-pick-edge:#000000}
.iso[data-theme="dark"]{--gr-on-top:#333333;--gr-on-side:#262626;--gr-on-edge:#ffffff;--gr-pick-top:#9a9a9a;--gr-pick-side:#6a6a6a;--gr-pick-edge:#ffffff}
.iso-solid.gr-tray[data-lit]>.iso-top{fill:var(--gr-on-top)}
.iso-solid.gr-tray[data-lit]>.iso-shade{fill:var(--gr-on-side)}
.iso-solid.gr-tray[data-lit]>.iso-edge{stroke:var(--gr-on-edge);stroke-width:1.5px}
.iso-solid.gr-pick>.iso-top,.iso-solid.gr-tok[data-lit]>.iso-top{fill:var(--gr-pick-top)}
.iso-solid.gr-pick>.iso-shade,.iso-solid.gr-tok[data-lit]>.iso-shade{fill:var(--gr-pick-side)}
.iso-solid.gr-pick>.iso-edge,.iso-solid.gr-tok[data-lit]>.iso-edge{stroke:var(--gr-pick-edge);stroke-width:1.4px}
.iso-plate-corner,.iso-legend{color:var(--anatomy-text)}
.gr-token{cursor:pointer}
.gr-files{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.gr-files button{font:inherit;font-size:12.5px;line-height:1.3;padding:5px 10px;border:1px solid var(--anatomy-faint);border-radius:6px;background:var(--anatomy-card);color:var(--anatomy-text);cursor:pointer}
.gr-files button:hover{border-color:var(--anatomy-mid)}
.gr-files button[aria-pressed="true"]{border-color:var(--anatomy-hi);color:var(--anatomy-strong)}
.gr-files button:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:2px}
.gr-note{margin:8px 0 0;padding:7px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:12px/1.5 var(--anatomy-mono);color:var(--anatomy-strong);min-height:2.6em}
.gr-table{width:100%;margin:10px 0 0;border-collapse:collapse;font-size:12.5px;line-height:1.45;word-break:keep-all}
.gr-table th,.gr-table td{padding:5px 8px;border-top:1px solid var(--anatomy-faint);text-align:left;vertical-align:top;font-weight:400}
.gr-table thead th{color:var(--anatomy-muted);font-size:11.5px;border-top:none}
.gr-table tbody tr{color:var(--anatomy-muted);transition:color .4s ease}
.gr-table tbody tr[data-on]{color:var(--anatomy-strong)}
.gr-table td.gr-n{font-family:var(--anatomy-mono);white-space:nowrap}
.gr-table tr[data-top] td.gr-n::after{content:" ◂";color:var(--anatomy-strong)}
.gr-table .gr-group{color:var(--anatomy-muted);font-size:11.5px;border-left:1px solid var(--anatomy-faint)}
.gr-table .gr-req{font-size:11px;padding:0 4px;margin-left:4px;border:1px solid var(--anatomy-mid);border-radius:3px;white-space:nowrap}
.gr-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (max-width:560px){.iso-plate{padding:42px 10px 80px;overflow:hidden}.gr-stage svg{width:108%;margin:0 -4%}.iso-plate-corner[data-corner="hint"]{bottom:34px}.iso-plate-corner[data-corner="readout"]{left:0;white-space:normal;line-height:1.4;text-align:right}.gr-table .gr-need{display:none}.gr-table{font-size:12px}.gr-note{font-size:11px}}
@media (prefers-reduced-motion:reduce){.gr-load,.gr-tier *,.gr-table tr{transition:none!important}}
`;

const DATA = {
  samples: SAMPLES.map((s) => ({ ...s, readout: readoutOf(s) })),
  P,
  railDy: -SY,
  railDz: SZ,
  lift: TOKEN.lift,
};

const LIVE = `
const D = ${JSON.stringify(DATA)};
const P = D.P;
const stage = document.querySelector(".gr-stage");
const svg = stage.querySelector("svg");
const car = svg.querySelector('[data-part="car"]');
const tiers = [...svg.querySelectorAll(".gr-tier")].sort((a, b) => a.dataset.tier - b.dataset.tier);
const trays = tiers.map((g) => g.querySelector("[data-tray] > .iso-solid"));
const tabs = tiers.map((g) => g.querySelector("[data-tab] > .iso-solid"));
const tokens = D.samples.map((s) => svg.querySelector('.gr-token[data-sample="' + s.id + '"]'));
const tokenSolids = tokens.map((g) => g.querySelector(".iso-solid"));
const rows = [...document.querySelectorAll(".gr-table tbody tr")];
const buttons = [...document.querySelectorAll(".gr-files button")];
const readout = document.querySelector("[data-readout]");
const note = document.querySelector("[data-note]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let pick = ${SAMPLES.indexOf(FIRST)}, level = D.samples[pick].top, lifts = D.samples.map((_, n) => (n === pick ? 1 : 0));
let frame = 0, last = 0, clock = 0, visible = false, touring = !still.matches, tourAt = 0, idle = 0;
const shown = new Array(6).fill(null);
function draw() {
  const s = D.samples[pick];
  car.setAttribute("transform", translateAlong(P, [0, D.railDy * level, D.railDz * level]));
  for (let i = 0; i < 6; i++) {
    const on = s.lit.includes(i) && level >= i - 0.06 ? (s.partial && i === 4 ? "part" : "full") : "";
    if (on !== shown[i]) {
      shown[i] = on;
      if (on) tiers[i].setAttribute("data-on", on === "part" ? "part" : ""); else tiers[i].removeAttribute("data-on");
      trays[i].toggleAttribute("data-lit", !!on);
      tabs[i].toggleAttribute("data-lit", !!on);
    }
  }
  tokens.forEach((g, n) => g.setAttribute("transform", translateAlong(P, [0, 0, D.lift * lifts[n]])));
}
function select(n) {
  pick = n;
  const s = D.samples[n];
  readout.textContent = s.readout;
  note.textContent = s.note;
  status.textContent = s.readout;
  buttons.forEach((b, m) => b.setAttribute("aria-pressed", String(m === n)));
  tokenSolids.forEach((g, m) => g.toggleAttribute("data-lit", m === n));
  rows.forEach((r) => {
    const g = Number(r.dataset.grade);
    r.toggleAttribute("data-on", s.lit.includes(g));
    r.toggleAttribute("data-top", g === s.top);
  });
  stage.setAttribute("aria-valuetext", s.readout);
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring && clock - tourAt > 4.6) { tourAt = clock; select((pick + 1) % D.samples.length); }
  const calm = still.matches;
  const ease = (v, to, tau) => { const n = calm ? to : v + (to - v) * (1 - Math.exp(-dt / tau)); return Math.abs(to - n) < 1e-3 ? to : n; };
  level = ease(level, D.samples[pick].top, 0.45);
  lifts = lifts.map((v, n) => ease(v, n === pick ? 1 : 0, 0.18));
  draw();
  const settled = level === D.samples[pick].top && lifts.every((v, n) => v === (n === pick ? 1 : 0));
  frame = visible && (touring || !settled) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } else if (!visible) draw(); };
function steer(n) {
  touring = false;
  clearTimeout(idle);
  idle = setTimeout(() => { if (still.matches) return; touring = true; tourAt = clock; run(); }, 9000);
  select(n);
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("click", (event) => {
  const g = event.target.closest(".gr-token");
  if (g) steer(Number(g.dataset.n));
});
buttons.forEach((b, n) => b.addEventListener("click", () => steer(n)));
stage.addEventListener("keydown", (event) => {
  const count = D.samples.length;
  let to;
  if (event.key === "ArrowRight" || event.key === "ArrowUp") to = (pick + 1) % count;
  else if (event.key === "ArrowLeft" || event.key === "ArrowDown") to = (pick + count - 1) % count;
  else if (event.key === "Home") to = 0;
  else if (event.key === "End") to = count - 1;
  else if (/^[1-9]$/.test(event.key) && Number(event.key) <= count) to = Number(event.key) - 1;
  else return;
  event.preventDefault();
  steer(to);
});
if (still.matches) touring = false;
// 검사 스크립트가 자세를 잡을 때 쓴다(drive.mjs 의 eval).
window.__grade = { select: steer, samples: D.samples.map((s) => s.id) };
select(pick);
draw();
if (parent !== window) document.documentElement.setAttribute("data-embed", "");
const size = () => parent !== window && parent.postMessage({ type: "guide-fig-size", fig: "grade", height: document.documentElement.scrollHeight }, "*");
addEventListener("load", size);
new ResizeObserver(size).observe(document.body);
`;

const KEYS = [
  { mark: "lit", label: "그 파일이 채운 칸" },
  { mark: "dim", label: "비어 있는 칸" },
  { mark: "edge", label: "승강기가 선 칸(표의 ◂): 그 파일이 닿은 가장 높은 등급" },
];
const CAPTION =
  "계단 한 칸이 등급 하나이고, 위 칸은 아래 칸을 전제로 합니다. 등급 0~2는 어디에 무엇이 있는가, 등급 3·4는 무엇이 무엇과 연결되어 있는가를 나타내며, 고객사에 필수로 요구하는 범위는 등급 0·1·2입니다. 일반 BIM은 대부분 등급 1~3까지 채워지고, 등급 4는 포트 방향까지 설계된 파일이나 규칙 보정에서 채워지며, 맨 위 등급 5는 BIM 외부(IDF·BAS)에서 받아 합칩니다.";

const GROUPS = { 5: ["BIM 밖", 1], 4: ["무엇이 무엇과 연결되어 있나", 2], 2: ["어디에 무엇이 있나", 3] };
function tableHtml() {
  const rows = [...GRADES].reverse().map((g) => {
    const group = GROUPS[g.n] ? `<td class="gr-group" rowspan="${GROUPS[g.n][1]}">${GROUPS[g.n][0]}</td>` : "";
    const req = REQUIRED.includes(g.n) ? `<span class="gr-req">필수</span>` : "";
    return `<tr data-grade="${g.n}"><td class="gr-n">${g.n}</td><td>${g.name}${req}</td><td>${g.dt}</td><td class="gr-need">${g.need}</td>${group}</tr>`;
  });
  return `<table class="gr-table"><thead><tr><th>칸</th><th>등급</th><th>DT 에서 되는 것</th><th class="gr-need">필요한 IFC</th><th></th></tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

function page(theme) {
  const plate = k.plateHtml({
    fig: "Fig 0",
    title: "이 BIM 으로 어디까지 되나",
    hint: "파일을 골라 등급 보기",
    readout: readoutOf(FIRST),
    keys: KEYS,
    caption: CAPTION,
    body: `<div class="iso-stage gr-stage" tabindex="0" role="slider" aria-label="등급 진열대. 파일 토큰이나 아래 버튼을 누르거나 화살표 키로 파일을 고르면 승강기가 그 파일의 가장 높은 등급 칸까지 오른다." aria-valuetext="${readoutOf(FIRST)}">${svg}<span class="gr-sr" role="status" aria-live="polite" data-status></span></div>`,
  });
  const files = `<div class="gr-files" role="group" aria-label="샘플 파일">${SAMPLES.map((s, n) => `<button type="button" aria-pressed="${s === FIRST}">${n + 1} · ${s.name}</button>`).join("")}</div>`;
  const extra = `${files}<p class="gr-note" data-note>${FIRST.note}</p>${tableHtml()}`;
  const html = `<style>${CSS}</style>` + plate.replace('<figcaption class="iso-legend">', `${extra}<figcaption class="iso-legend">`);
  return k.pageHtml({ title: "이 BIM 으로 어디까지 되나", theme, body: html, script: kitScript() + LIVE, width: 760 }).replace('<html lang="en">', '<html lang="ko">');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "grade.html"), page("light"));
writeFileSync(join(OUT, "grade-dark.html"), page("dark"));
const solids = (svg.match(/class="iso-solid/g) || []).length;
console.log(`wrote grade.html, grade-dark.html · ${solids} solids · ${(svg.match(/<path/g) || []).length} paths · scale ${P.scale.toFixed(3)}`);
