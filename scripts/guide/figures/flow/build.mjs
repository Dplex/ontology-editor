// 사용자 안내서 그림 2: 공조기에서 VAV·디퓨저로 가는 덕트에서 연결망 보기가 방향을 아는 이음(플랜지)만 따라 칠하고 슬리브에서 멈추는 모습을 보인다.
// 다시 만들려면 node scripts/guide/figures/flow/build.mjs 를 돌린다. --audit 를 붙이면 기하 검사를 한다.
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import * as G from "../../anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../anatomy/kit/tube.mjs";
import * as A from "../../anatomy/kit/audit.mjs";
import { ELEMENTS, CONNECTIONS, DEVICES, pickOf, isConduit } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "..", "public", "guide", "fig");

const AZ = 65;
const W = 600;
const H = 300;
const Z = 50;
const YT = -44;
const RT = 6;
const RO = 4.5;
const FT = 1.4;
const RFT = 9.5;
const RFO = 7.4;
const SL = 9;
const RB = 9;
const SPEED = 120;

const PLATE = { x: -192, y: -86, w: 410, d: 152, r: 10 };
const PLATE_H = 10;
const FOOT_H = 5;
const CAB = { x: -176, y: -74, w: 72, d: 58, r: 1.5 };
const CAB_Z = [6, 82];

const P = k.fitProjection(
  [...k.boxCorners(PLATE, -PLATE_H - FOOT_H, 0), [CAB.x, CAB.y, 90], [CAB.x + CAB.w, CAB.y + CAB.d, 90], [-10, 60, 64], [210, -44, 64]],
  W,
  H,
  { pad: 8, azimuth: AZ, elevation: 30 },
);
const V = G.viewOf(P);
const KS = G.scaleOf(P);
const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const Ln = (d, style) => k.lineSvg(d, style);
const Dots = (points, style) => k.dotsSvg(points, style);
const path3 = (points, closed = false) => k.pathOf(points.map(at), closed);

const R = A.recorder(P);
const record = R.solid;
/** 그림의 한 항목. el 은 그 항목이 속한 연결망 요소, along 은 흐름 방향으로 잰 요소 안 위치다. */
function put(name, el, ref, svg, shapes = [], { bias = 0, along = 0, joint } = {}) {
  const id = R.nameFor(name);
  R.put({ name: id, at: ref, bias, svg, shapes, piece: "rig", el, along, joint });
  return id;
}
const ITEM = (name) => R.items.find((item) => item.name === name);

// --- 공용 부품 ---------------------------------------------------------------

function discAt(name, el, F, s0, s1, r, style = {}, { extra = "", bias = 0, along = 0, owner, inner = "" } = {}) {
  const shape = record(A.disc(F, s0, s1, r, { name, owner }));
  return put(name, el, G.add3(F.o, G.mul3(F.a, (s0 + s1) / 2)), S(G.disc(s0, s1, r, F, P), { tone: "mid", ...style, inner }) + extra, [shape], { bias, along });
}
function flangeAt(name, el, F, s0, s1, r, { outward, bolts = 8, along = 0, owner, tone = "hi" } = {}) {
  const face = outward > 0 ? s1 : s0;
  const facing = G.dot3(G.mul3(F.a, outward), V);
  const dots = facing > 0.12 && bolts ? Dots(G.dotsOf(F, face, r * 0.8, bolts, P, { all: true }), { size: 0.42, tone: "mid" }) : "";
  return discAt(name, el, F, s0, s1, r, { tone }, { extra: dots, along, owner });
}
function slabAt(name, el, plan, z, h, style = {}, { extra = "", bias = 0, steps = 3, bevel = 0.4, inner = "" } = {}) {
  const shape = record(A.slab(plan, z, h, { name }, steps));
  return put(name, el, [plan.x + plan.w / 2, plan.y + plan.d / 2, z + h / 2], S(k.slabOf(plan, z, h, P, steps, bevel), { tone: "mid", ...style, inner }) + extra, [shape], { bias });
}
function cylAt(name, el, cx, cy, r, z, h, style = {}, { extra = "", bias = 0 } = {}) {
  const shape = record(A.cylinder(cx, cy, r, z, h, { name }));
  return put(name, el, [cx, cy, z + h / 2], S(k.cylinder(cx, cy, r, z, h, P, 24), { tone: "mid", ...style }) + extra, [shape], { bias });
}
function ballAt(name, el, c, r, style = {}) {
  const shape = record(A.ball(c, r, { name }));
  return put(name, el, c, S(G.sphereOf(c, r, P, { steps: 40 }), { tone: "hi", ...style }), [shape]);
}

/** 흐름 방향 표시(덕트에 찍힌 화살표). 포트가 방향을 적은 이음 옆에만 있다. */
function chevron(p, t, r) {
  const n = G.unit3(G.sub3(V, G.mul3(t, G.dot3(V, t))));
  const w = G.unit3(G.cross3(t, n));
  const half = Math.min(1.9, r * 0.42);
  const lift = Math.sqrt(r * r - half * half) + 0.05;
  const tip = G.add3(G.add3(p, G.mul3(t, 1.6)), G.mul3(n, r + 0.05));
  const tail = (side) => G.add3(G.add3(G.add3(p, G.mul3(t, -1.4)), G.mul3(w, side * half)), G.mul3(n, lift));
  return `<path class="iso-line fl-mark" data-tone="mid" data-free="" d="${path3([tail(-1), tip, tail(1)])}"/>`;
}

/**
 * 덕트 하나. 끝마다 "flange"(제 플랜지, 포트 이음), "sleeve"(맨 끝, 슬리브가 덮는다), "ball"(티 몸통 안에서 시작)을 고른다.
 * marks 는 흐름 화살표를 찍을 끝이다.
 */
function duct(name, el, control, r, { start = "flange", end = "flange", rf = r === RT ? RFT : RFO, marks = [], maxLength = 14, touch, breaks = [] } = {}) {
  // 슬리브 쪽 끝은 슬리브의 끝면에서 끝난다. 두 덕트가 슬리브 안에서 맞닿고, 슬리브가 그 자리를 덮는다.
  control = control.map((p) => [...p]);
  const trim = (index, toward) => {
    const d = G.unit3(G.sub3(control[toward], control[index]));
    control[index] = G.add3(control[index], G.mul3(d, SL / 2));
  };
  if (start === "sleeve") trim(0, 1);
  if (end === "sleeve") trim(control.length - 1, control.length - 2);
  const line = control.length > 2 ? G.fillet(control, Math.max(r * 2.6, 3), 12, { P, tube: r }) : control;
  const total = G.pathLength(line);
  const gaps = [];
  const rims = [];
  const caps = [true, true];
  [[start, 0], [end, 1]].forEach(([kind, index]) => {
    if (kind === "flange") gaps.push(index ? [total - FT, total] : [0, FT]);
    if (kind === "ball") caps[index] = false;
    rims.push(kind === "flange" ? rf : r);
  });
  R.route(name, line, r, { gaps, rims, piece: "rig", owner: name, touch: touch ?? [`${name}.stand.saddle*`] });
  const pieces = tubePieces(line, r, P, { maxLength, spacing: 0.8, gaps, caps, breaks: breaks.map((b) => (b < 0 ? total + b : b)) });
  const extras = pieces.map(() => "");
  for (const share of marks) {
    const s = share === 0 ? FT + 5 : total - FT - 5;
    const index = pieces.findIndex((piece) => piece.from <= s && piece.to >= s);
    extras[index] += chevron(G.pointAlong(line, s), G.tangentAlong(line, s), r);
  }
  pieces.forEach((piece, index) =>
    put(`${name}:${index}`, el, piece.mid, tubeSvg(piece, { tone: "hi" }) + extras[index], [A.tube(piece.points, piece.radii)], { along: (piece.from + piece.to) / 2 }),
  );
  [[start, 0], [end, 1]].forEach(([kind, index]) => {
    if (kind !== "flange") return;
    const tangent = G.tangentAlong(line, index ? total : 0);
    const F = G.frameAlong(G.pointAlong(line, index ? total : 0), tangent);
    const [s0, s1] = index ? [-FT, 0] : [0, FT];
    flangeAt(`${name}.flange${index}`, el, F, s0, s1, rf, { outward: index ? -1 : 1, along: index ? total : 0, owner: name });
  });
  return { line, total };
}

/** 맨 슬리브: 형상으로만 맞닿은 이음. 볼트도 화살표도 없다. */
function sleeveAt(name, joint, F, r) {
  const shape = record(A.disc(F, -SL / 2, SL / 2, r + 1.1, { name }));
  const seam = Ln(G.arcOf(F, 0, r + 1.1, P), { tone: "faint" });
  const id = put(name, null, F.o, S(G.disc(-SL / 2, SL / 2, r + 1.1, F, P), { tone: "mid", inner: seam }), [shape], { joint });
  ITEM(id).sleeve = joint;
  return id;
}

// --- 바닥판 -----------------------------------------------------------------

const back = [];
back.push(`<path class="iso-halo" d="${k.haloOf(PLATE, -PLATE_H - FOOT_H, PLATE_H, P)}"/>`);
const byDepth = (points) => [...points].sort((a, b) => k.depthOf([a[0], a[1], 0], P) - k.depthOf([b[0], b[1], 0], P));
for (const [x, y] of byDepth(k.corners(PLATE, 24))) {
  back.push(S(k.cylinder(x, y, 7, -PLATE_H - FOOT_H, 1.6, P, 28), { tone: "lo" }));
  back.push(S(k.cylinder(x, y, 5.4, -PLATE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 28), { tone: "mid" }));
}
back.push(S(k.slabOf(PLATE, -PLATE_H, PLATE_H, P, 8, 1.6), { tone: "mid", inner: Ln(k.sideSeam(PLATE, -4, P, 8), { tone: "faint" }) }));
back.push(Ln(k.planOutline(k.insetPlan(PLATE, 5), 0, P), { tone: "lo" }));
const plateScrews = k.corners(PLATE, 11);
back.push(Ln(plateScrews.map(([x, y]) => k.ring(x, y, 2.2, 0, P, 16)).join(""), { tone: "lo" }));
back.push(Dots(plateScrews.map(([x, y]) => at([x, y, 0])), { size: 0.5 }));
record(A.slab(PLATE, -PLATE_H, PLATE_H, { name: "stand.plate", ground: true }, 8));
const STRIP = { x: PLATE.x + 30, y: PLATE.y + PLATE.d - 13, w: 230, d: 6, r: 1 };
back.push(S(k.slabOf(STRIP, 0, 0.6, P, 3), { tone: "lo", crease: "none" }));
const ticks = k.topTicks(STRIP.x + 4, STRIP.x + STRIP.w - 4, 4, 5, STRIP.y, 0.6, [1.8, 3.4], P);
back.push(Ln(ticks.minor, { tone: "lo" }), Ln(ticks.major, { tone: "mid" }));
const LABEL = { x: 150, y: PLATE.y + PLATE.d - 26, w: 40, d: 14, r: 1.2 };
back.push(S(k.slabOf(LABEL, 0, 0.8, P, 3), { tone: "lo", crease: "none" }));
back.push(Ln(k.planOutline(k.insetPlan(LABEL, 1.4), 0.8, P, 3), { tone: "faint" }));
back.push(Ln([24, 16, 20].map((w, i) => k.lineOnTop([LABEL.x + 4, LABEL.y + 3.6 + i * 3.2], [LABEL.x + 4 + w, LABEL.y + 3.6 + i * 3.2], 0.8, P)).join(""), { tone: "lo", free: true }));
back.push(Dots([at([LABEL.x + LABEL.w - 2.8, LABEL.y + 2.6, 0.8]), at([LABEL.x + LABEL.w - 2.8, LABEL.y + LABEL.d - 2.6, 0.8])], { size: 0.45 }));

// --- 공조기 AHU-1 -------------------------------------------------------------

const AHU = "AHU-1";
back.push(`<path class="iso-halo" d="${k.haloOf(k.insetPlan(CAB, -2), 0, 4, P)}" style="filter:blur(5px)"/>`);
slabAt("ahu.plinth", AHU, { x: CAB.x - 3, y: CAB.y - 3, w: CAB.w + 6, d: CAB.d + 6, r: 1 }, 0, CAB_Z[0], { tone: "lo" }, { steps: 3, bevel: 0.5 });
{
  const FY = CAB.y + CAB.d;
  const joints = [-152, -128].map((x) => path3([[x, FY, CAB_Z[0]], [x, FY, CAB_Z[1]]])).join("");
  const seam = k.sideSeam(CAB, 22, P, 3);
  const top = CAB_Z[1];
  const screws = Dots([[CAB.x + 3, CAB.y + 3], [CAB.x + CAB.w - 3, CAB.y + 3], [CAB.x + 3, FY - 3], [CAB.x + CAB.w - 3, FY - 3], [-152, FY - 3], [-128, FY - 3]].map(([x, y]) => at([x, y, top])), { size: 0.45 });
  const lid = Ln(k.planOutline(k.insetPlan(CAB, 4), top, P, 3), { tone: "faint" });
  slabAt("ahu.cabinet", AHU, CAB, CAB_Z[0], CAB_Z[1] - CAB_Z[0], { tone: "mid" }, { steps: 3, bevel: 0.8, inner: Ln(joints, { tone: "lo" }) + Ln(seam, { tone: "faint" }), extra: lid + screws });
}
{
  const FY = CAB.y + CAB.d;
  for (const [x0, label] of [[-173, "filter"], [-125, "fan"]]) {
    const door = { x: x0, y: FY, w: 18, d: 0.9, r: 0.3 };
    slabAt(`ahu.door.${label}`, AHU, door, 12, 64, { tone: "mid" }, { steps: 2, bevel: 0 });
    for (const z of [17, 70]) cylAt(`ahu.hinge`, AHU, x0 - 0.9, FY + 0.9, 0.9, z - 3, 6, { tone: "mid" });
    const handle = { x: x0 + 13.5, y: FY + 0.9, w: 2.2, d: 1.8, r: 0.6 };
    slabAt(`ahu.handle`, AHU, handle, 40, 9, { tone: "hi" }, { steps: 2, bevel: 0 });
    if (label === "fan") {
      const c = [x0 + 8, FY + 0.9, 58];
      const ring = k.sideRing(c, 4.2, "y", P, 32);
      const ring2 = k.sideRing(c, 3.2, "y", P, 32);
      R.items.find((item) => item.name.startsWith("ahu.door.fan")).svg += Ln(ring, { tone: "lo" }) + Ln(ring2, { tone: "faint" });
    }
  }
  const plateFace = { x: -148, y: FY, w: 16, d: 0.5, r: 0.2 };
  slabAt("ahu.nameplate", AHU, plateFace, 58, 12, { tone: "lo" }, {
    steps: 2,
    bevel: 0,
    extra: Ln([11, 8, 12].map((w, i) => path3([[-146, FY + 0.5, 67 - i * 3], [-146 + w, FY + 0.5, 67 - i * 3]])).join(""), { tone: "lo", free: true }),
  });
  const drain = G.frameAlong([-140, FY, 13], [0, 1, 0]);
  discAt("ahu.drain", AHU, drain, 0, 4, 1.4, { tone: "mid" });
  discAt("ahu.drain.cap", AHU, drain, 4, 5.4, 1.9, { tone: "mid" });
}
{
  const intake = { x: -170, y: -68, w: 26, d: 22, r: 1 };
  const slots = [0, 1, 2, 3].map((i) => k.planOutline({ x: intake.x + 3, y: intake.y + 3 + i * 4.4, w: intake.w - 6, d: 2, r: 0.9 }, CAB_Z[1] + 6, P, 2)).join("");
  slabAt("ahu.intake", AHU, intake, CAB_Z[1], 6, { tone: "mid" }, { steps: 2, bevel: 0.4, extra: Ln(slots, { tone: "lo" }) });
  const ebox = { x: CAB.x + CAB.w, y: -28, w: 3, d: 10, r: 0.5 };
  slabAt("ahu.ebox", AHU, ebox, 18, 12, { tone: "mid" }, { steps: 2, bevel: 0, extra: Dots([at([ebox.x + 1.5, ebox.y + 2, 30]), at([ebox.x + 1.5, ebox.y + 8, 30])], { size: 0.4 }) });
}
const AHU_OUT = G.frameAlong([CAB.x + CAB.w, YT, Z], [1, 0, 0]);
discAt("ahu.outlet", AHU, AHU_OUT, 0, 6, RT + 0.6, { tone: "mid" });
flangeAt("ahu.outlet.flange", AHU, AHU_OUT, 6, 6 + FT, RFT, { outward: -1 });
const J1 = CAB.x + CAB.w + 6 + FT;

// --- 주 덕트와 티 -----------------------------------------------------------

const TEE_X = [-10, 70];
const STUB = 13;
const RIM = Math.sqrt(RB * RB - RT * RT);
const D1 = duct("duct-1", "DUCT-1", [[J1, YT, Z], [TEE_X[0] - STUB, YT, Z]], RT, { marks: [0, 1] });
function tee(id, x, eastEnd = "flange", eastReach = STUB) {
  ballAt(`${id}.ball`, id, [x, YT, Z], RB);
  duct(`${id}.west`, id, [[x - STUB, YT, Z], [x - RIM, YT, Z]], RT, { start: "flange", end: "ball" });
  duct(`${id}.east`, id, [[x + RIM, YT, Z], [x + eastReach, YT, Z]], RT, { start: "ball", end: eastEnd });
  duct(`${id}.branch`, id, [[x, YT + RIM, Z], [x, YT + STUB, Z]], RT, { start: "ball", end: "flange" });
}
tee("TEE-1", TEE_X[0]);
const D2 = duct("duct-2", "DUCT-2", [[TEE_X[0] + STUB, YT, Z], [TEE_X[1] - STUB, YT, Z]], RT, { marks: [0, 1] });
const SLEEVE_X = 94;
tee("TEE-2", TEE_X[1], "sleeve", SLEEVE_X - TEE_X[1]);
const VAV3_IN = 126;
const D3 = duct("duct-3", "DUCT-3", [[SLEEVE_X, YT, Z], [VAV3_IN, YT, Z]], RT, { start: "sleeve" });
sleeveAt("sleeve.J7", "J7", G.frameAlong([SLEEVE_X, YT, Z], [1, 0, 0]), RT);

// --- VAV -----------------------------------------------------------------------

function sensorTaps(id, F, list) {
  for (const s of list) {
    const p = G.add3(F.o, G.mul3(F.a, s));
    const N = G.frameAlong(p, [0, 0, 1]);
    const base = Math.sqrt(RT * RT - 1.1 * 1.1);
    discAt(`${id}.tap`, id, N, base, RT + 2.4, 1.1, { tone: "mid" });
    discAt(`${id}.tap.nut`, id, N, RT + 2.4, RT + 3.4, 1.5, { tone: "mid" });
  }
}
function postsUnder(id, plan, z) {
  for (const [x, y] of k.corners(plan, 4)) {
    cylAt(`${id}.foot`, null, x, y, 3, 0, 1.2, { tone: "lo" });
    cylAt(`${id}.post`, null, x, y, 1.6, 1.2, z - 1.2, { tone: "mid", crease: "none" });
  }
}
function boxBody(id, plan, z0, z1) {
  const top = z1;
  const panel = Ln(k.planOutline(k.insetPlan(plan, 3.5), top, P, 2), { tone: "faint" });
  const screws = Dots(k.corners(plan, 2).map(([x, y]) => at([x, y, top])), { size: 0.42 });
  slabAt(`${id}.box`, id, plan, z0, z1 - z0, { tone: "hi", crease: "lo" }, { steps: 2, bevel: 0.6, extra: panel + screws, inner: Ln(k.sideSeam(plan, z0 + 4, P, 2), { tone: "faint" }) });
}
/** VAV 하나. axis 는 흐름 방향(+x 또는 +y), inlet 은 입구 플랜지 면(조인트 면)이다. */
function vav(id, inlet, axis) {
  const F = G.frameAlong(inlet, axis);
  flangeAt(`${id}.in.flange`, id, F, 0, FT, RFT, { outward: -1 });
  discAt(`${id}.spigot`, id, F, FT, 15, RT, { tone: "mid" }, { extra: chevron(G.add3(inlet, G.mul3(axis, FT + 5)), axis, RT) });
  sensorTaps(id, F, [7, 11]);
  const back = G.add3(inlet, G.mul3(axis, 15));
  const along = axis[0] ? "x" : "y";
  const plan = along === "x" ? { x: back[0], y: back[1] - 16, w: 32, d: 32, r: 1.5 } : { x: back[0] - 16, y: back[1], w: 32, d: 32, r: 1.5 };
  postsUnder(id, plan, 36);
  boxBody(id, plan, 36, 64);
  const ctrl = along === "x" ? { x: plan.x + 8, y: plan.y + plan.d, w: 14, d: 4, r: 0.6 } : { x: plan.x + plan.w, y: plan.y + 6, w: 4, d: 14, r: 0.6 };
  slabAt(`${id}.ctrl`, id, ctrl, 44, 13, { tone: "mid" }, { steps: 2, bevel: 0.3, extra: Dots([at([ctrl.x + 1.2, ctrl.y + 1.2, 57]), at([ctrl.x + ctrl.w - 1.2, ctrl.y + ctrl.d - 1.2, 57])], { size: 0.38 }) });
  const out = G.add3(back, G.mul3(axis, 32));
  const O = G.frameAlong(out, axis);
  discAt(`${id}.out`, id, O, 0, 4, RO + 0.5, { tone: "mid" });
  flangeAt(`${id}.out.flange`, id, O, 4, 4 + FT, RFO, { outward: 1 });
  return G.add3(out, G.mul3(axis, 4 + FT));
}
const OUT1 = vav("VAV-1", [TEE_X[0], YT + STUB, Z], [0, 1, 0]);
const OUT2 = vav("VAV-2", [TEE_X[1], YT + STUB, Z], [0, 1, 0]);
const OUT3 = vav("VAV-3", [VAV3_IN, YT, Z], [1, 0, 0]);

// --- 디퓨저 ---------------------------------------------------------------------

function diffuser(id, face, axis, joint) {
  const F = G.frameAlong(face, axis);
  const neck0 = joint === "port" ? FT : SL / 2;
  if (joint === "port") flangeAt(`${id}.flange`, id, F, 0, FT, RFO, { outward: -1 });
  const profile = [[neck0, RO + 0.3], [6, RO + 0.3], [12, 11.4], [12, 12.4], [13.6, 12.4]];
  const shape = record(A.solid(F, profile, { name: `${id}.cone` }));
  const faceRings = [3.4, 6.4, 9.4].map((r) => G.circleOf(F, 13.6, r, P, 48)).join("");
  const plug = Dots([at(G.add3(face, G.mul3(axis, 13.6)))], { size: 1.1, tone: "mid" });
  put(`${id}.cone`, id, G.add3(face, G.mul3(axis, 7)), S(G.solidOf(profile, F, P), { tone: "hi" }) + Ln(faceRings, { tone: "lo" }) + plug, [shape]);
  return F;
}
function stand(id, x, y, top) {
  cylAt(`${id}.stand.foot`, null, x, y, 3.4, 0, 1.4, { tone: "lo" });
  cylAt(`${id}.stand.post`, null, x, y, 1.6, 1.4, top - 3 - 1.4, { tone: "mid", crease: "none" });
  slabAt(`${id}.stand.saddle`, null, { x: x - 4.5, y: y - 4.5, w: 9, d: 9, r: 1 }, top - 3, 3, { tone: "mid" }, { steps: 2, bevel: 0.3 });
}
const D_AT = 46;
duct("duct-4", "DUCT-4", [OUT1, [TEE_X[0], D_AT, Z]], RO, { marks: [0, 1] });
diffuser("D-1", [TEE_X[0], D_AT, Z], [0, 1, 0], "port");
duct("duct-5", "DUCT-5", [OUT2, [TEE_X[1], D_AT, Z]], RO, { end: "sleeve", marks: [0] });
const F2 = diffuser("D-2", [TEE_X[1], D_AT, Z], [0, 1, 0], "geometry");
sleeveAt("sleeve.J12", "J12", F2, RO);
const D3_AT = 200;
duct("duct-6", "DUCT-6", [OUT3, [D3_AT, YT, Z]], RO, { marks: [0, 1] });
diffuser("D-3", [D3_AT, YT, Z], [1, 0, 0], "port");

stand("duct-1", -60, YT, Z - RT);
stand("duct-2", 30, YT, Z - RT);
stand("duct-3", 112, YT, Z - RT);
stand("duct-4", TEE_X[0], 35, Z - RO);
stand("duct-5", TEE_X[1], 34, Z - RO);
stand("duct-6", 189, YT, Z - RO);

// --- 깊이 순서와 검사 ---------------------------------------------------------

A.settle(R, P);
R.items.sort((a, b) => a.key - b.key);

// --- 연결망 시간표 ---------------------------------------------------------------

const lengthOf = (id) => {
  const items = R.items.filter((item) => item.el === id);
  return isConduit(id) ? Math.max(20, ...items.map((item) => item.along)) : 30;
};
const PICKS = Object.fromEntries(DEVICES.map((id) => [id, pickOf(id, lengthOf)]));
/** 고른 기기마다 항목별 [모드, 칠하는 시각(초)]. 모드: p 고른 기기, d 하류, u 상류, l 방향 모름(이어짐), s 멈춘 슬리브. */
function scheduleOf(pick) {
  const L = Object.fromEntries(ELEMENTS.map((e) => [e.id, lengthOf(e.id)]));
  const stopAt = Math.min(...pick.stops.map((s) => s.at), Infinity);
  return R.items.map((item) => {
    if (item.sleeve) {
      const stop = pick.stops.find((s) => s.id === item.sleeve);
      return stop ? ["s", stop.at / SPEED] : null;
    }
    const el = item.el;
    if (!el) return null;
    if (el === pick.start) return ["p", 0];
    const conduit = isConduit(el);
    if (el in pick.down) return ["d", (pick.down[el] + (conduit && !el.startsWith("TEE") ? item.along : 0)) / SPEED];
    if (el in pick.up) return ["u", (pick.up[el] + (conduit && !el.startsWith("TEE") ? L[el] - item.along : 0)) / SPEED];
    if (pick.linked.includes(el)) return ["l", stopAt / SPEED + 0.3];
    return null;
  });
}
const SCHEDULE = Object.fromEntries(DEVICES.map((id) => [id, scheduleOf(PICKS[id])]));

const groups = R.items.map((item, index) => {
  const el = item.el ? ` data-el="${item.el}"${isConduit(item.el) ? "" : " data-dev"}` : "";
  const sleeve = item.sleeve ? ` data-sleeve="${item.sleeve}"` : "";
  return `<g class="it" data-i="${index}"${el}${sleeve}>${item.svg}</g>`;
});

const LABEL_TEXT =
  "공조기 한 대가 주 덕트로 VAV 세 대에 급기를 보내고, VAV마다 덕트 하나로 디퓨저에 잇는 모형이다. 볼트를 조인 플랜지 이음은 BIM 포트가 흐름 방향을 적은 연결이고, 맨 슬리브 이음은 형상으로 맞닿았다고 추정한 연결이다. 기기를 고르면 방향을 아는 연결만 따라 하류와 상류를 칠하고 슬리브에서 멈춘다.";
const svg = k.figureSvg({ width: W, height: H, label: LABEL_TEXT, body: [...back, `<g class="fl-rig">${groups.join("")}</g>`] });

// --- 쪽 -----------------------------------------------------------------------

const DATA = {
  devices: DEVICES,
  picks: Object.fromEntries(DEVICES.map((id) => {
    const p = PICKS[id];
    return [id, { up: p.upDevices, down: p.downDevices, linked: p.linkedDevices, stops: p.stops.map((s) => ({ id: s.id, at: s.at / SPEED })), lines: p.lines, downAt: Object.fromEntries(p.downDevices.map((d) => [d, p.down[d] / SPEED])), upAt: Object.fromEntries(p.upDevices.map((d) => [d, p.up[d] / SPEED])) }];
  })),
  schedule: SCHEDULE,
  tour: [["AHU-1", 6.5], ["VAV-2", 5.5], ["VAV-3", 5.5], ["D-1", 5.5]],
};

const CSS = `
.iso{--fl-dim:#9a9a9a;--fl-down:#1f9d7a;--fl-up:#e0803a;--fl-link:#9b59d0;--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace}
html{background:#f2f2ef}html:has(body[data-theme="dark"]){background:#0b0b0b}html[data-embed],html[data-embed]:has(body){background:transparent}html:has(body[data-theme="light"]),body[data-theme="light"]{color-scheme:light}body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.iso-page{width:100%;margin:0}
.iso-figure{margin:0}
.iso-plate{padding:46px 18px 44px}
.iso-plate-corner[data-corner="title"]{letter-spacing:.04em}
.iso-plate-corner[data-corner="hint"]{letter-spacing:.04em}
.fl-stage{outline:none;touch-action:pan-y}
.fl-stage:focus-visible{outline:1px solid var(--anatomy-muted);outline-offset:6px}
.it[data-dev]{cursor:pointer}
.it .iso-shade,.it .iso-top,.it .iso-fill,.it .tb-body,.it .tb-shine,.it .tb-shade{transition:fill .45s ease}
.it .iso-edge,.it .tb-edge,.it .fl-mark{transition:stroke .45s ease}
.it[data-fl]{--fl-c:var(--fl-down)}
.it[data-fl="u"]{--fl-c:var(--fl-up)}
.it[data-fl="l"],.it[data-fl="s"]{--fl-c:var(--fl-link)}
.it:is([data-fl="d"],[data-fl="u"]) .iso-top,.it:is([data-fl="d"],[data-fl="u"]) .tb-shine{fill:color-mix(in srgb,var(--fl-c) 16%,var(--anatomy-top))}
.it:is([data-fl="d"],[data-fl="u"]) .iso-shade[data-shade="3"]{fill:color-mix(in srgb,var(--fl-c) 22%,var(--anatomy-shade-3))}
.it:is([data-fl="d"],[data-fl="u"]) .iso-shade[data-shade="2"],.it:is([data-fl="d"],[data-fl="u"]) .tb-body{fill:color-mix(in srgb,var(--fl-c) 28%,var(--anatomy-shade-2))}
.it:is([data-fl="d"],[data-fl="u"]) .iso-shade[data-shade="1"]{fill:color-mix(in srgb,var(--fl-c) 34%,var(--anatomy-shade-1))}
.it:is([data-fl="d"],[data-fl="u"]) .iso-shade[data-shade="0"],.it:is([data-fl="d"],[data-fl="u"]) .tb-shade{fill:color-mix(in srgb,var(--fl-c) 40%,var(--anatomy-shade-0))}
.it:is([data-fl="d"],[data-fl="u"]) .iso-edge,.it:is([data-fl="d"],[data-fl="u"]) .tb-edge{stroke:color-mix(in srgb,var(--fl-c) 75%,var(--anatomy-hi))}
.it[data-fl] .fl-mark{stroke:var(--fl-c)}
.it[data-fl="l"] .iso-top,.it[data-fl="l"] .tb-shine{fill:color-mix(in srgb,var(--fl-c) 7%,var(--anatomy-top))}
.it[data-fl="l"] .iso-shade,.it[data-fl="l"] .tb-body,.it[data-fl="l"] .tb-shade{fill:color-mix(in srgb,var(--fl-c) 11%,var(--anatomy-shade-2))}
.it[data-fl="l"] .iso-edge,.it[data-fl="l"] .tb-edge{stroke:color-mix(in srgb,var(--fl-c) 45%,var(--anatomy-mid))}
.it[data-fl="p"] .iso-top{fill:var(--anatomy-lit-top)}
.it[data-fl="p"] .iso-edge,.it[data-fl="p"] .tb-edge{stroke:var(--anatomy-lit);stroke-width:1.15}
.it[data-fl="p"] .fl-mark{stroke:var(--anatomy-lit)}
.it[data-fl="s"] .iso-edge{stroke:var(--fl-link);stroke-width:1.15}
.it[data-hot] .iso-top,.it[data-hot] .tb-shine{fill:color-mix(in srgb,var(--fl-c) 46%,var(--anatomy-top))}
.it[data-hot] .iso-shade,.it[data-hot] .tb-body,.it[data-hot] .tb-shade{fill:color-mix(in srgb,var(--fl-c) 62%,var(--anatomy-shade-2))}
.it[data-hot] .iso-edge,.it[data-hot] .tb-edge{stroke:var(--fl-c)}
.iso-swatch[data-mark="green"] path{stroke:var(--fl-down)}
.iso-swatch[data-mark="red"] path{stroke:var(--fl-up)}
.iso-swatch[data-mark="blue"] path{stroke:var(--fl-link)}
.iso[data-theme="light"]{--fl-dim:#68686c}
.iso-plate-corner[data-corner="title"],.iso-plate-corner[data-corner="hint"],.iso-legend{color:var(--fl-dim)}
.fl-ttl{margin:10px 0 0;padding:10px 12px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:11.5px/1.65 var(--anatomy-mono);color:var(--fl-dim);white-space:pre-wrap;word-break:break-all;min-height:5.6em}
.fl-ttl b{font-weight:400;color:var(--anatomy-text)}
.fl-ttl [data-to]{transition:color .4s ease;color:var(--fl-dim)}
.fl-ttl [data-to][data-on]{color:var(--anatomy-strong);font-weight:600}
.fl-ttl .fl-c{opacity:0;transition:opacity .4s ease}
.fl-ttl .fl-c[data-on]{opacity:1}
.fl-sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0)}
@media (max-width:560px){.iso-plate{padding:42px 10px 64px;overflow:hidden}.fl-stage svg{width:108%;margin:0 -4%}.fl-ttl{font-size:10.5px}}
@media (prefers-reduced-motion:reduce){.it *{transition:none!important}}
`;

const LIVE = `
const D = ${JSON.stringify(DATA)};
const stage = document.querySelector(".fl-stage");
const svg = stage.querySelector("svg");
const items = [...svg.querySelectorAll(".it")];
const readout = document.querySelector("[data-readout]");
const ttl = document.querySelector("[data-ttl]");
const status = document.querySelector("[data-status]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
const HOT = 0.22;
const mode = new Array(items.length).fill(""), hot = new Array(items.length).fill(false);
let pick = null, t0 = 0, clock = 0, last = 0, frame = 0, visible = false, touring = !still.matches, tourAt = 0, tourIndex = 0, idle = 0, said = "";
const sweepOf = (id) => Math.max(0.4, ...D.schedule[id].filter(Boolean).map((s) => s[1]));
function ttlFor(id) {
  const p = D.picks[id];
  const subjects = [...new Set(p.lines.map((l) => l[0]))];
  const rows = subjects.map((s) => "<b>ex:" + s + "</b> brick:feeds " + p.lines.filter((l) => l[0] === s).map((l) => '<span data-to="' + l[1] + '">ex:' + l[1] + "</span>").join(", ") + " ;");
  if (!rows.length) rows.push("# 칠한 범위 안에 brick:feeds 쌍이 없다");
  if (p.linked.length) rows.push('<span class="fl-c"># ' + p.linked.map((d) => "ex:" + d).join(", ") + " : 방향 모름 이음 너머, feeds 없음</span>");
  ttl.innerHTML = rows.join("\\n");
}
function select(id) {
  pick = id;
  t0 = clock;
  if (id) ttlFor(id); else ttl.innerHTML = "# 기기를 고르면 그 연결망에서 나가는 brick:feeds를 보인다";
  stage.setAttribute("aria-valuetext", id ? summary(id, true) : "고른 기기 없음");
  status.textContent = id ? summary(id, true) : "";
  run();
}
function summary(id, done, e = Infinity) {
  const p = D.picks[id];
  const down = p.down.filter((d) => p.downAt[d] <= e).length;
  const up = p.up.filter((d) => p.upAt[d] <= e).length;
  const lines = p.lines.filter(([a, b]) => reached(p, a, e) && reached(p, b, e)).length;
  const stopped = p.stops.some((s) => s.at <= e);
  const parts = [id];
  if (up || !down) parts.push("상류 " + up + "대");
  if (down || !up) parts.push("하류 " + down + "대");
  parts.push("feeds " + lines + "쌍");
  if (stopped) parts.push("방향 모름에서 멈춤");
  return parts.join(" · ");
}
const reached = (p, d, e) => d === pick || (p.downAt[d] ?? p.upAt[d] ?? Infinity) <= e;
function draw() {
  const e = pick ? (still.matches ? Infinity : clock - t0) : 0;
  const plan = pick ? D.schedule[pick] : null;
  const period = pick ? sweepOf(pick) + 1.6 : 1;
  const loop = e === Infinity ? Infinity : e > period ? (e - period) % (period) : e;
  items.forEach((g, i) => {
    const s = plan && plan[i];
    const m = s && e >= s[1] ? s[0] : "";
    const h = !!s && !still.matches && m !== "" && m !== "l" && m !== "p" && Math.abs(loop - s[1] - HOT / 2) < HOT / 2 + 0.04;
    if (m !== mode[i]) { mode[i] = m; if (m) g.setAttribute("data-fl", m); else g.removeAttribute("data-fl"); }
    if (h !== hot[i]) { hot[i] = h; g.toggleAttribute("data-hot", h); }
  });
  if (pick) {
    const p = D.picks[pick];
    ttl.querySelectorAll("[data-to]").forEach((s) => s.toggleAttribute("data-on", reached(p, s.dataset.to, e)));
    const c = ttl.querySelector(".fl-c");
    if (c) c.toggleAttribute("data-on", p.stops.some((s) => s.at <= e));
  }
  const text = pick ? summary(pick, false, e) : "기기를 고르면 연결망을 따라 표시합니다";
  if (text !== said) { said = text; readout.textContent = text; }
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring && clock - tourAt >= D.tour[tourIndex][1]) { tourIndex = (tourIndex + 1) % D.tour.length; tourAt = clock; select(D.tour[tourIndex][0]); }
  draw();
  frame = visible && (touring || (pick && !still.matches)) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } else if (!visible || still.matches) draw(); };
function steer(id) {
  touring = false;
  clearTimeout(idle);
  idle = setTimeout(() => { if (still.matches) return; touring = true; tourAt = clock; tourIndex = Math.max(0, D.tour.findIndex((t) => t[0] === pick)); run(); }, 7000);
  select(id);
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);
stage.addEventListener("click", (event) => {
  const g = event.target.closest(".it[data-dev]");
  if (g) steer(g.dataset.el);
});
stage.addEventListener("keydown", (event) => {
  const here = Math.max(0, D.devices.indexOf(pick));
  let to;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") to = D.devices[(here + 1) % D.devices.length];
  else if (event.key === "ArrowLeft" || event.key === "ArrowUp") to = D.devices[(here + D.devices.length - 1) % D.devices.length];
  else if (event.key === "Home") to = D.devices[0];
  else if (event.key === "End") to = D.devices[D.devices.length - 1];
  else if (event.key === "Escape") to = null;
  else return;
  event.preventDefault();
  steer(to);
});
window.__flow = { select: steer, picks: D.picks };
select(D.tour[0][0]);
if (still.matches) draw();
if (parent !== window) document.documentElement.setAttribute("data-embed", "");
const size = () => parent !== window && parent.postMessage({ type: "guide-fig-size", fig: "flow", height: document.documentElement.scrollHeight }, "*");
addEventListener("load", size);
new ResizeObserver(size).observe(document.body);
`;

const KEYS = [
  { mark: "green", label: "하류: 방향을 아는 연결로 흐름을 따라 닿은 곳" },
  { mark: "red", label: "상류: 흐름을 거슬러 닿은 곳" },
  { mark: "blue", label: "이어짐: 방향 모름 이음 너머, 다음 기기까지" },
];
const CAPTION =
  "볼트를 조인 플랜지 이음은 BIM 포트가 흐름 방향까지 기록한 연결이고, 민무늬 슬리브 이음은 편집기가 형상 접촉으로 추정한 연결이라 방향 정보가 없습니다. 연결망 보기는 방향을 아는 연결만 따라가다가 슬리브에서 멈추며, 슬리브 구간은 [계통 편집]에서 포트로 전환하고 방향을 지정하면 끝까지 흐름이 이어집니다.";

function page(theme) {
  const plate = k.plateHtml({
    fig: "Fig 7",
    title: "흐름은 어디까지 아나",
    hint: "기기를 눌러 연결망 보기",
    readout: "AHU-1 · 하류 3대 · feeds 3쌍 · 방향 모름에서 멈춤",
    keys: KEYS,
    caption: CAPTION,
    body: `<div class="iso-stage fl-stage" tabindex="0" role="slider" aria-label="흐름 방향 모형. 기기를 누르거나 화살표 키로 기기를 고르면 연결망을 칠한다. Esc 는 선택을 푼다." aria-valuetext="AHU-1">${svg}<span class="fl-sr" role="status" aria-live="polite" data-status></span></div>`,
  });
  const ttl = `<pre class="fl-ttl" data-ttl aria-label="이 연결망에서 TTL 로 나가는 brick:feeds"></pre>`;
  const body = `<style>${CSS}</style>` + plate.replace("</figure>", `${ttl}</figure>`);
  return k.pageHtml({ title: "흐름은 어디까지 아나", theme, body, script: LIVE, width: 760 }).replace('<html lang="en">', '<html lang="ko">');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "flow.html"), page("light"));
writeFileSync(join(OUT, "flow-dark.html"), page("dark"));
const solids = R.solids.length;
console.log(`wrote flow.html, flow-dark.html · ${R.items.length} items · ${solids} shapes · scale ${KS.toFixed(3)}`);
A.auditOrExit(R, P, {});
