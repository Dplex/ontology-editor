// 가이드 그림 1: 천장 갠트리에 매단 FCU 의 다림추가 떨어진 (x, y) 로 설비가 어느 방에 드는지 판정하는 모형이다(src/lib/mapping.ts).
// 다시 만들려면 `node scripts/guide/figures/assign/build.mjs` 를 돌린다. public/guide/fig/assign.html(밝은 판)과 assign-dark.html 이 나온다.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import { kitScript } from "../../anatomy/scripts/inline-kit.mjs";
import { SNAP, SNAP_RANGE, judge, ttlLine } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..", "..", "..");
const OUT = join(ROOT, "public", "guide", "fig");

// 1 m 를 14 단위로 그린다. 방·간격·허용 거리 모두 같은 축척이다.
const K = 14;
const u = (m) => m * K;
const plan = (x, y, w, d, r = 0.4) => ({ x: u(x), y: u(y), w: u(w), d: u(d), r });

const WIDTH = 600;
const HEIGHT = 400;

// 방 외곽선(m). 대기실 6×5 m 가 접수대 2.4×1.4 m 를 품고, 0.6 m 통로 건너 회의실 4×3.6 m 가 있다.
const ROOMS = [
  { id: "대기실", x: 0.8, y: 1.2, w: 6, d: 5, z0: 0, h: 0.16, tag: [1.3, 5.1, 2.0] },
  { id: "회의실", x: 7.4, y: 1.8, w: 4, d: 3.6, z0: 0, h: 0.16, tag: [7.9, 4.3, 2.0] },
  { id: "접수대", x: 4.0, y: 4.4, w: 2.4, d: 1.4, z0: 0.16, h: 0.14, tag: [4.2, 4.8, 1.55] },
];
const SPACES = ROOMS.map((r) => ({
  id: r.id,
  areaM2: r.w * r.d,
  footprint: [[r.x, r.y], [r.x + r.w, r.y], [r.x + r.w, r.y + r.d], [r.x, r.y + r.d]],
}));
const OUTER = ["대기실", "회의실"];
const STOREY = "1F";
const EQUIPMENT = "FCU_1";

const BASE = plan(-1.3, -1.8, 14.5, 11.3, 8);
const BASE_H = 9;
const FOOT_H = 5;

// 갠트리(m). 뒤쪽 레일을 기둥 셋이 받치고, 레일 위 트럭이 x 로, 팔 위 캐리지가 y 로 움직인다.
const H = 2.6;
const RAIL = { y: -1.3, d: 0.4, z: H, h: 0.32, x0: -1.0, x1: 12.9 };
const POSTS = [-0.6, 6.0, 12.5];
const POST_Y = -1.1;
const TRUCK = { half: 0.62, y0: -1.48, y1: -0.72, z: H + 0.32, h: 0.3 };
const ARM = { half: 0.17, y0: -0.72, y1: 8.3, z: H + 0.32, h: 0.3 };
const CAR = { half: 0.42, hy: 0.5, z: H + 0.22, h: 0.52 };
const FCU = { half: 0.7, hy: 0.46, z: H - 0.5, h: 0.4 };
const ROD = { off: 0.4, r: 0.035 };
const BOB = { z0: 0.42, z1: 0.58, z2: 0.86, r: 0.16, tip: 0.05 };
const REACH = { x: [0.2, 11.6], y: [0.6, 7.6] };

// 앞쪽 테두리: 눈금자, 이름판, 허용 거리 손잡이.
const RULER = plan(0, 8.05, 8.0, 0.42, 1);
const SIDE_RULER = plan(12.15, 0, 0.42, 7.5, 1);
const LABEL = plan(-0.8, 8.65, 3.6, 0.6, 1.2);
const CONSOLE = plan(8.9, 8.0, 3.6, 1.2, 2.5);
const CONSOLE_H = 0.32;
const KNOB = [u(11.55), u(8.6)];
const KNOB_R = 3.3;
const DIAL_R = 5.8;
const KNOB_TOP = u(CONSOLE_H) + 3.4;
// 눈금은 앞쪽(보는 쪽)으로 돈다. 0 이 오른쪽 뒤, 1 m 가 왼쪽 뒤다.
const DIAL_FROM = Math.PI * 0.25;
const DIAL_SPAN = Math.PI * 1.5;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [u(RAIL.x0), u(RAIL.y), u(H + 0.65)],
    [u(RAIL.x1), u(RAIL.y), u(H + 0.65)],
    [u(REACH.x[0]), u(ARM.y1), u(H + 0.8)],
    [u(REACH.x[1]), u(ARM.y1), u(H + 0.8)],
  ],
  WIDTH,
  HEIGHT,
  { pad: 26, azimuth: 52, elevation: 38 },
);

const at = (point) => k.iso(point, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (points, style) => k.dotsSvg(points, style);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
// 세로 면 위의 닫힌 사각형(그릴·점검구 윤곽). 끝이 없어서 선 끝 검사에 걸리지 않는다.
const faceRect = (corners) => `M${corners.map((p) => at(p).map((v) => v.toFixed(1)).join(" ")).join("L")}Z`;

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of byDepth(k.corners(BASE, 22))) {
    out.push(S(k.cylinder(x, y, 7, -BASE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.4, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
  }
  out.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.6), { tone: "lo" }));
  const groove = k.insetPlan(BASE, 5);
  out.push(L(k.planOutline(groove, 0, P), { tone: "faint" }));
  // 1 m 격자. 홈 선에서 홈 선까지 긋는다.
  const grid = [];
  for (let x = 0; x <= 12; x++) grid.push(k.lineOnTop([u(x), groove.y], [u(x), groove.y + groove.d], 0, P));
  for (let y = 0; y <= 8; y++) grid.push(k.lineOnTop([groove.x, u(y)], [groove.x + groove.w, u(y)], 0, P));
  out.push(L(grid.join(""), { tone: "faint" }));
  const screws = k.corners(BASE, 10);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
  return out.join("");
}

// 허용 거리 띠: 방 외곽선을 허용 거리만큼 키운 둥근 사각형. 직사각형에서 거리 t 인 점의 자리가 정확히 이 모양이다.
function bandPaths(room, snap) {
  const t = Math.max(snap, 0.001);
  const grown = { x: u(room.x - t), y: u(room.y - t), w: u(room.w + 2 * t), d: u(room.d + 2 * t), r: u(t) };
  const d = k.planOutline(grown, 0, P, 10);
  return { fill: d, line: d };
}

function bands(snap) {
  return OUTER.map((id) => {
    const room = ROOMS.find((r) => r.id === id);
    const { fill, line } = bandPaths(room, snap);
    return `<g data-band="${id}"><path class="as-band" d="${fill}"/><path class="iso-line as-band-edge" data-tone="mid" d="${line}"/></g>`;
  }).join("");
}

function roomPlate(room) {
  const p = plan(room.x, room.y, room.w, room.d, 0.6);
  const top = u(room.z0 + room.h);
  const inner = k.insetPlan(p, 2.2);
  const out = [S(k.slabOf(p, u(room.z0), u(room.h), P, 3, 0.4), { tone: "hi", crease: "lo", className: "as-room-plate" })];
  out.push(L(k.planOutline(inner, top, P, 3), { tone: "faint" }));
  out.push(D(k.corners(p, 1.2).map(([x, y]) => at([x, y, top])), { size: 0.42, tone: "lo" }));
  // 방 이름표: 판에 박힌 명판에 방 이름(BIM 의 공간 이름)을 새긴다. TTL 의 목적어가 이 이름이다.
  if (room.tag) {
    const [tx, ty, tw] = room.tag;
    const tag = plan(tx, ty, tw, 0.85, 1.2);
    const tagTop = top + 0.6;
    out.push(S(k.slabOf(tag, top, 0.6, P, 3), { tone: "mid", crease: "none", className: "as-tag" }));
    out.push(L(k.planOutline(k.insetPlan(tag, 1.2), tagTop, P, 3), { tone: "faint" }));
    out.push(k.faceTextSvg(k.topMatrix([tag.x + 2.6, tag.y + tag.d - 3.0], tagTop, P, "x"), room.id, { size: 5.8, tone: "hi" }));
  }
  return `<g data-room="${room.id}" class="as-room">${out.join("")}</g>`;
}

function rulers() {
  const out = [];
  out.push(S(k.slabOf(RULER, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const t = k.topTicks(RULER.x, RULER.x + RULER.w, u(0.5), 2, RULER.y, 0.6, [2, 3.8], P);
  out.push(L(t.minor, { tone: "lo" }), L(t.major, { tone: "mid" }));
  out.push(S(k.slabOf(SIDE_RULER, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
  const s = k.topTicks(SIDE_RULER.y, SIDE_RULER.y + SIDE_RULER.d, u(0.5), 2, SIDE_RULER.x, 0.6, [2, 3.8], P, "y");
  out.push(L(s.minor, { tone: "lo" }), L(s.major, { tone: "mid" }));
  return out.join("");
}

function labelPlate() {
  const out = [S(k.slabOf(LABEL, 0, 0.8, P, 4), { tone: "mid", crease: "none" })];
  out.push(L(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P), { tone: "faint" }));
  const y0 = LABEL.y + 2.6;
  [[0.62, 0], [0.42, 2.0], [0.52, 4.0]].forEach(([share, dy]) => {
    const x0 = LABEL.x + 6;
    out.push(L(k.lineOnTop([x0, y0 + dy], [x0 + (LABEL.w - 14) * share, y0 + dy], 0.8, P), { tone: "lo", free: true }));
  });
  out.push(D([at([LABEL.x + 3, LABEL.y + LABEL.d / 2, 0.8]), at([LABEL.x + LABEL.w - 3, LABEL.y + LABEL.d / 2, 0.8])], { size: 0.45 }));
  return out.join("");
}

function consoleBlock() {
  const top = u(CONSOLE_H);
  const out = [S(k.slabOf(CONSOLE, 0, top, P, 6, 0.6), { tone: "mid" })];
  out.push(L(k.planOutline(k.insetPlan(CONSOLE, 2.4), top, P, 4), { tone: "faint" }));
  out.push(D([at([CONSOLE.x + 4.4, CONSOLE.y + 4.4, top]), at([CONSOLE.x + 4.4, CONSOLE.y + CONSOLE.d - 4.4, top])], { size: 0.45 }));
  out.push(k.faceTextSvg(k.topMatrix([CONSOLE.x + 8, CONSOLE.y + CONSOLE.d / 2 + 1.2], top, P, "x"), "허용 거리", { size: 3.1, tone: "lo" }));
  const [cx, cy] = KNOB;
  out.push(L(k.ring(cx, cy, DIAL_R, top, P, 64), { tone: "lo" }));
  const ticks = k.radialTicks(cx, cy, DIAL_R, 10, 5, top, [1.0, 1.7], P, DIAL_FROM, DIAL_SPAN);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  const zero = [Math.sin(DIAL_FROM), -Math.cos(DIAL_FROM)];
  out.push(L(k.lineOnTop([cx + zero[0] * (DIAL_R - 1.7), cy + zero[1] * (DIAL_R - 1.7)], [cx + zero[0] * DIAL_R, cy + zero[1] * DIAL_R], top, P), { tone: "hi" }));
  out.push(S(k.cylinder(cx, cy, KNOB_R + 0.6, top, 1.2, P, 40), { tone: "lo" }));
  out.push(S(k.cylinder(cx, cy, KNOB_R, top + 1.2, KNOB_TOP - top - 1.2, P, 40, 0.4), { tone: "mid" }));
  out.push(L(k.knurl(cx, cy, KNOB_R, top + 1.4, KNOB_TOP, 40, P), { tone: "lo" }));
  out.push(L(k.ring(cx, cy, 1.4, KNOB_TOP, P, 16), { tone: "mid" }));
  return out.join("");
}

// 손잡이 지시선: 허용 거리 0~1 m 를 270° 에 편다.
function knobPointer(kit, snap) {
  const angle = DIAL_FROM + (snap / SNAP_MAX) * DIAL_SPAN;
  const [cx, cy] = KNOB;
  const sx = Math.sin(angle), sy = -Math.cos(angle);
  return kit.lineOnTop([cx + sx * 1.4, cy + sy * 1.4], [cx + sx * KNOB_R, cy + sy * KNOB_R], KNOB_TOP, P);
}

function gantryStatic() {
  const out = [];
  for (const x of POSTS) {
    const [px, py] = [u(x), u(POST_Y)];
    out.push(`<path class="iso-halo" d="${k.haloOf({ x: px - 6, y: py - 6, w: 12, d: 12, r: 6 }, 0, 0.1, P)}" style="filter:blur(4px)"/>`);
    out.push(S(k.slabOf({ x: px - 5.5, y: py - 5.5, w: 11, d: 11, r: 1.4 }, 0, 1.4, P, 3, 0.4), { tone: "mid" }));
    out.push(D(k.corners({ x: px - 5.5, y: py - 5.5, w: 11, d: 11, r: 1.4 }, 1.8).map(([x, y]) => at([x, y, 1.4])), { size: 0.4 }));
    out.push(S(k.cylinder(px, py, 3.4, 1.4, 2.4, P, 28), { tone: "mid" }));
    out.push(S(k.cylinder(px, py, 2.4, 3.8, u(H) - 3.8 - 2.2, P, 28), { tone: "mid", crease: "none" }));
    out.push(L([u(0.8), u(1.6)].map((z) => k.sideArc(px, py, 2.4, z, P, 16)).join(""), { tone: "faint" }));
    out.push(S(k.slabOf({ x: px - 4, y: u(RAIL.y) - 0.6, w: 8, d: u(RAIL.d) + 1.2, r: 1 }, u(H) - 2.2, 2.2, P, 3, 0.4), { tone: "mid" }));
  }
  const rail = { x: u(RAIL.x0), y: u(RAIL.y), w: u(RAIL.x1 - RAIL.x0), d: u(RAIL.d), r: 1 };
  out.push(S(k.slabOf(rail, u(H), u(RAIL.h), P, 3, 0.5), { tone: "mid" }));
  const railTop = u(H + RAIL.h);
  out.push(L(k.lineOnTop([rail.x, rail.y + rail.d / 2], [rail.x + rail.w, rail.y + rail.d / 2], railTop, P), { tone: "faint" }));
  out.push(D([0, 2, 4, 6, 8, 10, 12].map((x) => at([u(x), rail.y + 1.3, railTop])), { size: 0.38, tone: "lo" }));
  for (const x of [RAIL.x0, RAIL.x1 - 0.3]) {
    const stop = { x: u(x), y: rail.y - 0.8, w: u(0.3), d: rail.d + 1.6, r: 0.8 };
    out.push(S(k.slabOf(stop, railTop, 3.2, P, 3, 0.4), { tone: "mid" }));
    out.push(D([at([stop.x + stop.w / 2, stop.y + stop.d / 2, railTop + 3.2])], { size: 0.42 }));
  }
  return out.join("");
}

// 트럭과 팔은 x 로만 움직인다(원점 x = 0 에서 짓고 옮긴다). 팔은 캐리지 앞뒤로 잘라 매 프레임 다시 짓는다.
function truck() {
  const t = { x: -u(TRUCK.half), y: u(TRUCK.y0), w: u(TRUCK.half * 2), d: u(TRUCK.y1 - TRUCK.y0), r: 1.2 };
  const top = u(TRUCK.z + TRUCK.h);
  const out = [S(k.slabOf(t, u(TRUCK.z), u(TRUCK.h), P, 3, 0.5), { tone: "mid" })];
  out.push(D(k.corners(t, 1.8).map(([x, y]) => at([x, y, top])), { size: 0.42 }));
  return out.join("");
}

function armSegments(kit, cy) {
  const half = ARM.half * 14, z = ARM.z * 14, h = ARM.h * 14;
  const c0 = (cy - CAR.hy) * 14, c1 = (cy + CAR.hy) * 14;
  const y0 = ARM.y0 * 14, y1 = ARM.y1 * 14;
  const top = z + h;
  const seg = (a, b, cap) => {
    if (b - a < 0.2) return "";
    const p = { x: -half, y: a, w: half * 2, d: b - a, r: 0.6 };
    const parts = [kit.solidSvg(kit.slabOf(p, z, h, P, 2, 0.4), { tone: "mid" })];
    const rivets = [];
    for (let y = y0 + 6; y < y1 - 3; y += 14) if (y > a + 1.5 && y < b - 1.5) rivets.push(kit.iso([0, y, top], P));
    if (rivets.length) parts.push(kit.dotsSvg(rivets, { size: 0.36, tone: "lo" }));
    if (cap) {
      const end = { x: -half - 0.8, y: y1 - 1.6, w: half * 2 + 1.6, d: 1.6, r: 0.4 };
      parts.push(kit.solidSvg(kit.slabOf(end, z - 0.8, h + 1.6, P, 2, 0.3), { tone: "mid" }));
    }
    return parts.join("");
  };
  return { back: seg(y0, c0, false), front: seg(c1, y1 - 1.6, true) };
}

// 캐리지·FCU·다림추는 원점 (0, 0) 에서 짓고 (x, y) 로 옮긴다. 다림추 → FCU → 매단 봉 → 캐리지 순으로 그린다(위에 있는 것이 앞).
function plumb() {
  const out = [];
  out.push(L(k.segment([0, 0, u(BOB.z2)], [0, 0, u(FCU.z)], P), { tone: "hi" }));
  out.push(S(k.cylinder(0, 0, u(BOB.tip) + 0.3, u(BOB.z0), u(BOB.z1 - BOB.z0), P, 16), { tone: "hi", crease: "lo" }));
  out.push(S(k.cylinder(0, 0, u(BOB.r), u(BOB.z1), u(BOB.z2 - BOB.z1), P, 28, 0.3), { tone: "hi", crease: "lo" }));
  out.push(L(k.ring(0, 0, 0.6, u(BOB.z2), P, 10), { tone: "mid" }));
  return out.join("");
}

function fcu() {
  const f = { x: -u(FCU.half), y: -u(FCU.hy), w: u(FCU.half * 2), d: u(FCU.hy * 2), r: 0.8 };
  const z0 = u(FCU.z), z1 = u(FCU.z + FCU.h);
  const out = [`<path class="iso-halo" d="${k.haloOf(k.insetPlan(f, 2), z0, 0.1, P)}" style="filter:blur(5px);opacity:calc(var(--anatomy-halo-opacity) * .5)"/>`];
  const yFace = f.y + f.d;
  const xFace = f.x + f.w;
  // 앞면(+y) 송풍 그릴: 가로 슬롯 다섯 줄.
  const slots = [];
  for (let i = 0; i < 5; i++) {
    const z = z0 + 1.0 + i * 0.78;
    slots.push(faceRect([[f.x + 2.2, yFace, z], [xFace - 2.2, yFace, z], [xFace - 2.2, yFace, z + 0.34], [f.x + 2.2, yFace, z + 0.34]]));
  }
  // 옆면(+x) 점검구.
  const hatch = faceRect([[xFace, f.y + 3, z0 + 0.9], [xFace, f.y + f.d - 3, z0 + 0.9], [xFace, f.y + f.d - 3, z1 - 0.9], [xFace, f.y + 3, z1 - 0.9]]);
  const inner = L(slots.join(""), { tone: "lo" }) + L(hatch, { tone: "faint" });
  out.push(S(k.slabOf(f, z0, z1 - z0, P, 3, 0.5), { tone: "hi", crease: "lo", inner }));
  out.push(D([at([xFace, f.y + 1.8, (z0 + z1) / 2]), at([xFace, f.y + f.d - 1.8, (z0 + z1) / 2])], { size: 0.4, tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(f, 1.6), z1, P, 3), { tone: "faint" }));
  return out.join("");
}

function rods() {
  const out = [];
  const z0 = u(FCU.z + FCU.h), z1 = u(CAR.z);
  for (const x of byDepth([[-u(ROD.off), 0], [u(ROD.off), 0]]).map(([x]) => x)) {
    out.push(S(k.cylinder(x, 0, 1.3, z0, 0.9, P, 16), { tone: "mid" }));
    out.push(S(k.cylinder(x, 0, u(ROD.r), z0 + 0.9, z1 - z0 - 0.9, P, 12), { tone: "mid", crease: "none" }));
  }
  return out.join("");
}

function carriage() {
  const c = { x: -u(CAR.half), y: -u(CAR.hy), w: u(CAR.half * 2), d: u(CAR.hy * 2), r: 1.2 };
  const z0 = u(CAR.z), z1 = u(CAR.z + CAR.h);
  const seam = L(k.sideSeam(c, z0 + 2.2, P, 3), { tone: "faint" });
  const out = [S(k.slabOf(c, z0, z1 - z0, P, 3, 0.5), { tone: "mid", inner: seam })];
  out.push(L(k.planOutline(k.insetPlan(c, 1.8), z1, P, 3), { tone: "faint" }));
  out.push(D(k.corners(c, 3.2).map(([x, y]) => at([x, y, z1])), { size: 0.42 }));
  return out.join("");
}

// 다림추가 떨어진 자리 표시. 그 자리 바닥(방 판 위면 판 윗면) 높이에 그린다.
function markAt(kit, x, y, z) {
  const r = 3.2;
  const ring = kit.ring(x, y, r, z, P, 24);
  const cross = kit.lineOnTop([x - r, y], [x + r, y], z, P) + kit.lineOnTop([x, y - r], [x, y + r], z, P);
  return `<path class="iso-line" data-tone="hi" d="${ring}"/><path class="iso-line" data-tone="mid" d="${cross}"/>`;
}

const START = { x: 2.5, y: 3.2, snap: SNAP };
const SNAP_MAX = SNAP_RANGE.max;
const first = judge([START.x, START.y], SPACES, START.snap);

const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label:
    "층 평면을 본뜬 받침판 위에 방 세 개가 낮은 판으로 놓여 있다. 왼쪽 큰 판이 대기실이고 그 안의 작은 판이 접수대, 0.6 m 통로 건너 오른쪽이 회의실이다. 뒤쪽 레일에 매달린 팔이 FCU 를 싣고 움직이고, FCU 에서 내린 다림추가 닿는 수평 좌표로 설비가 든 방을 판정한다. 방 둘레의 띠가 소속 허용 거리이고 앞쪽 손잡이로 0~1 m 사이에서 바꾼다.",
  body: [
    base(),
    `<g data-part="bands">${bands(START.snap)}</g>`,
    `<g data-slot="floor"></g>`,
    roomPlate(ROOMS[0]),
    roomPlate(ROOMS[1]),
    `<g data-slot="plate"></g>`,
    roomPlate(ROOMS[2]),
    `<g data-slot="top"><g data-part="mark">${markAt(k, u(START.x), u(START.y), u(0.16))}</g></g>`,
    gantryStatic(),
    `<g data-part="slide" transform="${k.translateAlong(P, [u(START.x), 0, 0])}">${truck()}<g data-part="arm-back">${armSegments(k, START.y).back}</g>` +
      `<g data-part="head" transform="${k.translateAlong(P, [0, u(START.y), 0])}">${plumb()}${fcu()}${rods()}${carriage()}</g>` +
      `<g data-part="arm-front">${armSegments(k, START.y).front}</g></g>`,
    rulers(),
    labelPlate(),
    consoleBlock(),
    `<path data-part="pointer" class="iso-line" data-tone="hi" d="${knobPointer(k, START.snap)}" style="stroke-width:1"/>`,
    `<path data-part="knob-hit" class="as-hit" d="${k.planOutline(k.insetPlan(CONSOLE, -3), u(CONSOLE_H), P, 4)}"/>`,
  ],
});

function readoutOf(result, spaces) {
  if (result.how === "inside") {
    const n = result.containing.length;
    return n > 1 ? `외곽선 안 · ${result.spaceId} (겹친 ${n}곳 중 가장 작은 방)` : `외곽선 안 · ${result.spaceId}`;
  }
  if (result.how === "near") return `허용 거리 안 ${result.distances[result.spaceId].toFixed(2)} m · ${result.spaceId}`;
  const nearest = Math.min(...spaces.map((s) => result.distances[s.id]));
  return `소속 없음 · 가장 가까운 외곽선 ${nearest.toFixed(2)} m`;
}

const model = readFileSync(join(HERE, "model.mjs"), "utf8").replace(/^export /gm, "");

const live = `
${model}
const P = ${JSON.stringify(P)};
const K = ${K};
const ROOMS = ${JSON.stringify(ROOMS)};
const SPACES = ${JSON.stringify(SPACES)};
const OUTER = ${JSON.stringify(OUTER)};
const STOREY = ${JSON.stringify(STOREY)}, EQUIPMENT = ${JSON.stringify(EQUIPMENT)};
const ARM = ${JSON.stringify(ARM)}, CAR = ${JSON.stringify(CAR)}, REACH = ${JSON.stringify(REACH)};
const KNOB = ${JSON.stringify(KNOB)}, KNOB_R = ${KNOB_R}, KNOB_TOP = ${KNOB_TOP};
const DIAL_FROM = ${DIAL_FROM}, DIAL_SPAN = ${DIAL_SPAN}, SNAP_MAX = ${SNAP_MAX};
const u = (m) => m * K;
const kit = { solidSvg, slabOf, dotsSvg, iso, lineOnTop, ring, planOutline };
const armSegments = ${armSegments.toString()};
const knobPointer = ${knobPointer.toString()};
const markAt = ${markAt.toString()};
const readoutOf = ${readoutOf.toString()};
const bandPaths = (room, snap) => { const t = Math.max(snap, 0.001); const d = planOutline({ x: u(room.x - t), y: u(room.y - t), w: u(room.w + 2 * t), d: u(room.d + 2 * t), r: u(t) }, 0, P, 10); return { fill: d, line: d }; };

const stage = document.querySelector(".iso-stage");
const svg = stage.querySelector("svg");
const $ = (sel) => svg.querySelector(sel);
const slide = $('[data-part="slide"]'), head = $('[data-part="head"]');
const armBack = $('[data-part="arm-back"]'), armFront = $('[data-part="arm-front"]');
const mark = $('[data-part="mark"]'), pointer = $('[data-part="pointer"]'), knobHit = $('[data-part="knob-hit"]');
const slots = { floor: $('[data-slot="floor"]'), plate: $('[data-slot="plate"]'), top: $('[data-slot="top"]') };
const plates = Object.fromEntries(ROOMS.map((r) => [r.id, $('[data-room="' + r.id + '"] > .iso-solid')]));
const bandEls = Object.fromEntries(OUTER.map((id) => [id, $('[data-band="' + id + '"]')]));
const readout = document.querySelector("[data-readout]");
const ttl = document.querySelector("[data-ttl]");
const snapText = document.querySelector("[data-snap]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// 다림추 아래 바닥 높이: 판 위면 판 윗면이다(그림의 높이일 뿐 판정에는 안 쓴다).
function surfaceAt(x, y) {
  let z = 0, slot = "floor";
  for (const r of ROOMS) {
    if (x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.d && r.z0 + r.h > z) { z = r.z0 + r.h; slot = r.z0 > 0 ? "top" : "plate"; }
  }
  return { z, slot };
}

// 투어: 대기실 안 → 접수대(겹친 방 중 작은 방) → 통로(0.05 m 로는 소속 없음) → 허용 거리를 0.4 m 로(가까운 대기실) → 회의실 쪽으로 → 빈 바닥.
const TOUR = [
  { x: 2.5, y: 3.2, snap: 0.05, hold: 2.6 },
  { x: 6.05, y: 4.75, snap: 0.05, hold: 2.8 },
  { x: 7.05, y: 3.6, snap: 0.05, hold: 2.6 },
  { x: 7.05, y: 3.6, snap: 0.4, hold: 2.6 },
  { x: 7.25, y: 3.6, snap: 0.4, hold: 2.6 },
  { x: 10.0, y: 7.2, snap: 0.4, hold: 2.6 },
  { x: 10.0, y: 7.2, snap: 0.05, hold: 1.4 },
];
const TOUR_LEN = TOUR.reduce((s, t) => s + t.hold, 0);
const tourAt = (t) => { let c = t % TOUR_LEN; for (const step of TOUR) { if (c < step.hold) return step; c -= step.hold; } return TOUR[0]; };

let x = ${START.x}, y = ${START.y}, snap = ${START.snap};
let target = { x, y, snap };
let frame = 0, last = 0, clock = 0, touring = !still.matches, visible = false, idleTimer = 0, drawnSnap = -1, lastKey = "";

function draw() {
  slide.setAttribute("transform", translateAlong(P, [u(x), 0, 0]));
  head.setAttribute("transform", translateAlong(P, [0, u(y), 0]));
  const seg = armSegments(kit, y);
  armBack.innerHTML = seg.back;
  armFront.innerHTML = seg.front;
  const surface = surfaceAt(x, y);
  if (mark.parentNode !== slots[surface.slot]) slots[surface.slot].appendChild(mark);
  mark.innerHTML = markAt(kit, u(x), u(y), u(surface.z));
  if (snap !== drawnSnap) {
    for (const id of OUTER) {
      const room = ROOMS.find((r) => r.id === id);
      const p = bandPaths(room, snap);
      bandEls[id].children[0].setAttribute("d", p.fill);
      bandEls[id].children[1].setAttribute("d", p.line);
    }
    pointer.setAttribute("d", knobPointer(kit, snap));
    drawnSnap = snap;
  }
  const shown = Math.round(snap * 100) / 100;
  const result = judge([x, y], SPACES, shown);
  for (const id in plates) {
    if (id === result.spaceId) plates[id].setAttribute("data-lit", ""); else plates[id].removeAttribute("data-lit");
  }
  for (const id of OUTER) bandEls[id].toggleAttribute("data-on", result.how === "near" && result.spaceId === id);
  const text = readoutOf(result, SPACES);
  if (readout.textContent !== text) readout.textContent = text;
  const line = ttlLine(EQUIPMENT, result.spaceId, STOREY);
  if (ttl.textContent !== line) ttl.textContent = line;
  const snapLine = "허용 거리 " + shown.toFixed(2) + " m";
  if (snapText.textContent !== snapLine) snapText.textContent = snapLine;
  const key = result.how + ":" + result.spaceId;
  if (key !== lastKey) { lastKey = key; status.textContent = text.split(" · ")[0] + (result.spaceId ? ", " + result.spaceId : ""); }
}

function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  const calm = still.matches;
  if (touring) { clock += dt; target = { ...tourAt(clock) }; }
  const ease = (v, to, tau) => { const n = calm ? to : v + (to - v) * (1 - Math.exp(-dt / tau)); return Math.abs(to - n) < 5e-4 ? to : n; };
  x = ease(x, target.x, touring ? 0.42 : 0.16);
  y = ease(y, target.y, touring ? 0.42 : 0.16);
  snap = ease(snap, target.snap, 0.3);
  draw();
  const settled = !touring && x === target.x && y === target.y && snap === target.snap;
  frame = visible && !settled ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } };
const pause = () => { touring = false; clearTimeout(idleTimer); idleTimer = setTimeout(() => { touring = !still.matches; clock = 0; run(); }, 3600); };
const steer = (next) => { pause(); target = { x: clamp(next.x ?? target.x, REACH.x[0], REACH.x[1]), y: clamp(next.y ?? target.y, REACH.y[0], REACH.y[1]), snap: clamp(next.snap ?? target.snap, 0, SNAP_MAX) }; run(); };
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);

// 포인터 → 바닥(z = 0) 좌표. 바닥 평면에서 투영은 아핀이라 2×2 를 풀면 된다.
const o = iso([0, 0, 0], P), ex = iso([1, 0, 0], P), ey = iso([0, 1, 0], P);
const ax = [ex[0] - o[0], ex[1] - o[1]], ay = [ey[0] - o[0], ey[1] - o[1]];
const det = ax[0] * ay[1] - ax[1] * ay[0];
function floorAt(event) {
  const pt = svg.createSVGPoint(); pt.x = event.clientX; pt.y = event.clientY;
  const p = pt.matrixTransform(svg.getScreenCTM().inverse());
  const dx = p.x - o[0], dy = p.y - o[1];
  return { x: (dx * ay[1] - dy * ay[0]) / det / K, y: (ax[0] * dy - ax[1] * dx) / det / K };
}
let dragging = null;
const onKnob = (event) => event.target === knobHit;
stage.addEventListener("pointerdown", (event) => {
  dragging = onKnob(event) ? { knob: true, y0: event.clientY, s0: target.snap } : { knob: false };
  stage.setPointerCapture(event.pointerId);
  if (!dragging.knob) steer(floorAt(event));
  else pause();
});
stage.addEventListener("pointermove", (event) => {
  if (dragging?.knob) { steer({ snap: dragging.s0 + (dragging.y0 - event.clientY) / 160 }); return; }
  if (dragging || event.pointerType === "mouse") { if (!dragging && onKnob(event)) return; steer(floorAt(event)); }
});
const release = () => { dragging = null; };
stage.addEventListener("pointerup", release);
stage.addEventListener("pointercancel", release);
knobHit.addEventListener("wheel", (event) => { event.preventDefault(); steer({ snap: target.snap + (event.deltaY < 0 ? 0.05 : -0.05) }); }, { passive: false });
stage.addEventListener("keydown", (event) => {
  const step = event.shiftKey ? 1 : 0.1;
  const map = { ArrowLeft: { x: target.x - step }, ArrowRight: { x: target.x + step }, ArrowUp: { y: target.y - step }, ArrowDown: { y: target.y + step },
    PageUp: { snap: target.snap + 0.05 }, PageDown: { snap: target.snap - 0.05 }, "+": { snap: target.snap + 0.05 }, "=": { snap: target.snap + 0.05 }, "-": { snap: target.snap - 0.05 },
    Home: { snap: 0 }, End: { snap: SNAP_MAX } };
  const next = map[event.key];
  if (!next) return;
  event.preventDefault();
  steer(next);
});
if (still.matches) touring = false;
// 검사 스크립트가 자세를 잡을 때 쓴다(drive.mjs 의 eval).
window.__assignPose = (px, py, ps) => steer({ x: px, y: py, snap: ps });
draw();
`;

const PAGE_CSS = `
*{box-sizing:border-box}
html{color-scheme:light}
body[data-theme="dark"]{color-scheme:dark}
body{margin:0;background:transparent;color:var(--anatomy-text);font:14px/1.6 "Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.iso{--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR","Apple SD Gothic Neo","Malgun Gothic",monospace}
.iso-page{width:100%;margin:0;padding:1px}
.iso-figure{margin:0}
.iso-plate{padding:46px 18px 50px}
.iso-plate-corner{font-family:"Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif;font-size:11.5px;letter-spacing:0}
.iso-plate-corner[data-corner="fig"]{font-family:var(--anatomy-mono)}
.iso-plate-corner[data-corner="readout"]{color:var(--anatomy-strong)}
.iso-face-text{font-family:"Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif;letter-spacing:0}
.iso-stage{outline:none;touch-action:pan-y;cursor:crosshair}
.iso-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.iso[data-theme="light"]{--anatomy-shade-0:#cfcfcc;--anatomy-shade-1:#d9d9d6;--anatomy-shade-2:#e3e3e0;--anatomy-shade-3:#ececea;--anatomy-mid:#76767c;--anatomy-lo:#a4a4a9;--anatomy-faint:#cdcdd0;--anatomy-muted:#6b6b70;
  --as-room-top:#f1f1ef;--as-room-side:#dcdcd9;--as-room-edge:#76767c;--as-lit-top:#8e8e95;--as-lit-side:#6e6e75;--as-lit-edge:#000000;--as-tag-top:#ffffff;
  --as-band:#d6d6d9;--as-band-on:#b6b6bc;--as-band-edge:#8a8a90}
.iso[data-theme="dark"]{--as-room-top:#1d1d1d;--as-room-side:#161616;--as-room-edge:#6a6a6a;--as-lit-top:#4a4a4a;--as-lit-side:#333333;--as-lit-edge:#ffffff;--as-tag-top:#2a2a2a;
  --as-band:#262626;--as-band-on:#363636;--as-band-edge:#6a6a6a}
.as-room-plate>.iso-top{fill:var(--as-room-top)}
.as-room-plate>.iso-shade{fill:var(--as-room-side)}
.as-room-plate>.iso-edge{stroke:var(--as-room-edge);stroke-width:1px}
.as-room-plate[data-lit]>.iso-top{fill:var(--as-lit-top)}
.as-room-plate[data-lit]>.iso-shade{fill:var(--as-lit-side)}
.as-room-plate[data-lit]>.iso-edge{stroke:var(--as-lit-edge);stroke-width:1.6px}
.as-tag>.iso-top{fill:var(--as-tag-top)}
.as-room .iso-face-text{font-weight:500}
.as-band{fill:var(--as-band);stroke:none}
.as-band-edge{stroke:var(--as-band-edge)!important;stroke-width:.9px}
[data-band][data-on] .as-band{fill:var(--as-band-on)}
[data-band][data-on] .as-band-edge{stroke:var(--anatomy-hi)!important;stroke-width:1.3px}
.as-hit{fill:transparent;stroke:none;pointer-events:all;cursor:ns-resize}
.as-ttl{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 16px;margin-top:10px;padding:7px 10px;background:var(--anatomy-card);box-shadow:0 0 0 1px var(--anatomy-faint);font:12px/1.5 var(--anatomy-mono);color:var(--anatomy-strong)}
.as-ttl [data-snap]{color:var(--anatomy-text)}
.iso-plate-corner{color:var(--anatomy-text)}
.iso-legend{color:var(--anatomy-text)}
.iso-legend{margin-top:10px;font-size:13px;word-break:keep-all}
.as-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:560px){.iso-plate{padding:42px 8px 66px}.iso-plate .iso-svg{width:112%;margin:0 -6%}.iso-plate{overflow:hidden}.iso-plate-corner{font-size:10.5px}}
`;

const caption =
  "설비 위치의 수평 좌표만 보고, 같은 층 방의 외곽선 안에 들면 그 방에 붙인다. 방이 겹치면 면적이 가장 작은 방이다. 어느 방에도 안 들면 소속 허용 거리(기본 0.05 m, 0~1 m) 안에서 가장 가까운 방에 붙이고, 그마저 없으면 소속 없음이라 TTL 에는 방 대신 층이 적힌다.";

const keys = [
  { mark: "lit", label: "판정된 방" },
  { mark: "raised", label: "방 외곽선과 이름표" },
  { mark: "flat", label: "소속 허용 거리 띠" },
];

const swatch = (mark) => k.plateHtml({ fig: "", keys: [{ mark, label: "" }], body: "" }).match(/<svg class="iso-swatch"[\s\S]*?<\/svg>/)[0];

function page(theme) {
  const corner = (name, text, extra = "") => `<span class="iso-plate-corner" data-corner="${name}"${extra}>${text}</span>`;
  const stage = `<div class="iso-stage" tabindex="0" role="group" aria-label="설비 소속 판정 모형. 화살표 키로 설비를 옮기고(Shift 는 1 m), Page Up·Page Down 이나 +·- 로 소속 허용 거리를 바꾼다.">${svg}</div>`;
  const body = `<figure class="iso-figure"><div class="iso-plate"><div class="iso-plate-corners" aria-hidden="true">${corner("fig", "Fig 1")}${corner("title", "설비는 어느 방에 있나")}${corner("hint", "드래그해서 설비 옮기기 · 손잡이로 허용 거리")}${corner("readout", readoutOf(first, SPACES), " data-readout")}</div>${stage}</div>` +
    `<div class="as-ttl"><code data-ttl>${ttlLine(EQUIPMENT, first.spaceId, STOREY)}</code><span data-snap>허용 거리 ${SNAP.toFixed(2)} m</span></div>` +
    `<figcaption class="iso-legend"><span class="iso-keys">${keys.map((key) => `<span class="iso-key">${swatch(key.mark)}${key.label}</span>`).join("")}</span><span class="iso-caption">${caption}</span></figcaption></figure>` +
    `<span class="as-sr" aria-live="polite" data-status></span>`;
  const script = (kitScript() + live).replace(/<\/(script)/gi, "<\\/$1");
  return `<!doctype html><html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>설비는 어느 방에 있나</title><style>${k.ISO_CSS}${PAGE_CSS}</style></head><body class="iso" data-theme="${theme}"><main class="iso-page">${body}</main><script type="module">${script}</script></body></html>`;
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "assign.html"), page("light"));
writeFileSync(join(OUT, "assign-dark.html"), page("dark"));
console.log("wrote public/guide/fig/assign.html, assign-dark.html ·", first.how, first.spaceId);
