// 가이드 그림 1: 건축(Arch.ifc) + 설비(HVAC.ifc) 두 파일을 층 표고와 수평 원점 핀으로 맞춰 합치는 정합 지그 모형이다.
// 다시 만들려면 `node scripts/guide/figures/merge/build.mjs` 를 돌린다.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import * as G from "../../anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../anatomy/kit/tube.mjs";
import { kitScript } from "../../anatomy/scripts/inline-kit.mjs";
import { STAGES, readoutOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "..", "public", "guide", "fig");

const WIDTH = 600;
const HEIGHT = 400;

const BASE = { x: -16, y: -16, w: 214, d: 154, r: 6 };
const BASE_H = 8;
const FOOT_H = 5;
const ARCH_PLATE = { x: 4, y: 6, w: 172, d: 102, r: 3 };
const ARCH_Z = 4;
const ARCH_H = 5;

const ROOMS = [
  { id: "Utility", x: 12, y: 14, w: 46, d: 84, tag: [16, 82, 34] },
  { id: "Bedroom 1", x: 62, y: 14, w: 54, d: 84, tag: [66, 82, 42] },
  { id: "Living", x: 120, y: 14, w: 48, d: 84, tag: [124, 82, 36] },
];

const POSTS = [
  [10, 11],
  [170, 11],
  [10, 103],
  [170, 103],
];
const POST_H = 76;

const EQPS = [
  { id: "Boiler", room: "Utility", x: 24, y: 38, w: 22, d: 18, h: 14, big: true },
  { id: "Diffuser 1", room: "Bedroom 1", x: 82, y: 42, w: 14, d: 14, h: 8 },
  { id: "Diffuser 2", room: "Living", x: 138, y: 42, w: 14, d: 14, h: 8 },
];

const RULER_X = { x: 8, y: 116, w: 120, d: 5, r: 1 };
const CONSOLE = { x: 134, y: 112, w: 52, d: 18, r: 2 };
const KNOB = [172, 121];
const KNOB_R = 5.2;
const DIAL_R = 8.4;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [ARCH_PLATE.x - 24, ARCH_PLATE.y - 16, POST_H + 38],
    [ARCH_PLATE.x + ARCH_PLATE.w + 18, ARCH_PLATE.y + ARCH_PLATE.d + 22, POST_H + 38],
  ],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: 52, elevation: 35 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const box = (x, y, w, d, r = 0.5) => ({ x, y, w, d, r });

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of k.corners(BASE, 18).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P))) {
    out.push(S(k.cylinder(x, y, 6.8, -BASE_H - FOOT_H, 1.6, P, 26), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.2, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 26), { tone: "mid" }));
  }
  out.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.5), { tone: "lo", inner: L(k.sideSeam(BASE, -3.5, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(BASE, 4.5), 0, P), { tone: "faint" }));
  const grid = [];
  for (let gx = 10; gx <= 170; gx += 20) grid.push(k.lineOnTop([gx, 6], [gx, 110], 0, P));
  for (let gy = 16; gy <= 106; gy += 18) grid.push(k.lineOnTop([4, gy], [176, gy], 0, P));
  out.push(L(grid.join(""), { tone: "faint" }));

  const screws = k.corners(BASE, 9);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2.1, 0, P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.48 }));

  out.push(S(k.slabOf(RULER_X, 0, 0.7, P, 2), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(RULER_X.x + 4, RULER_X.x + RULER_X.w - 4, 4, 5, RULER_X.y, 0.7, [1.6, 3.2], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));

  const cTop = 4.2;
  out.push(S(k.slabOf(CONSOLE, 0, cTop, P, 4, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(CONSOLE, 2), cTop, P, 3), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([CONSOLE.x + 4, CONSOLE.y + 11], cTop, P, "x"), "정합 노브", { size: 3.6, tone: "hi" }));
  const [kx, ky] = KNOB;
  out.push(L(k.ring(kx, ky, DIAL_R, cTop, P, 48), { tone: "lo" }));
  const rTicks = k.radialTicks(kx, ky, DIAL_R, 12, 3, cTop, [1.1, 1.9], P, Math.PI * 0.25, Math.PI * 1.5);
  out.push(L(rTicks.minor, { tone: "lo" }), L(rTicks.major, { tone: "mid" }));
  out.push(S(k.cylinder(kx, ky, KNOB_R + 0.7, cTop, 1.2, P, 32), { tone: "lo" }));
  out.push(S(k.cylinder(kx, ky, KNOB_R, cTop + 1.2, 3.8, P, 32, 0.4), { tone: "hi" }));
  out.push(L(k.knurl(kx, ky, KNOB_R, cTop + 1.4, cTop + 4.8, 32, P), { tone: "lo" }));
  return out.join("");
}

function archTray() {
  const out = [];
  for (const [x, y] of k.corners(ARCH_PLATE, 12)) {
    out.push(S(k.cylinder(x, y, 3.4, 0, ARCH_Z, P, 18), { tone: "mid" }));
  }
  out.push(S(k.slabOf(ARCH_PLATE, ARCH_Z, ARCH_H, P, 5, 0.8), { tone: "mid", inner: L(k.sideSeam(ARCH_PLATE, ARCH_Z + 2, P, 5), { tone: "faint" }) }));
  const top = ARCH_Z + ARCH_H;
  out.push(L(k.planOutline(k.insetPlan(ARCH_PLATE, 2.5), top, P, 4), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([ARCH_PLATE.x + 5, ARCH_PLATE.y + ARCH_PLATE.d - 3.2], top, P, "x"), "ARCH.IFC · LEVEL 2 (+3.10m)", { size: 4.0, tone: "lo" }));

  for (const r of ROOMS) {
    const rp = box(r.x, r.y, r.w, r.d, 1.2);
    const rTop = top + 2.2;
    const plate = S(k.slabOf(rp, top, 2.2, P, 3, 0.4), { tone: "hi", crease: "lo", className: "mg-room" });
    const inner = L(k.planOutline(k.insetPlan(rp, 2), rTop, P, 2), { tone: "faint" });
    const backWall = S(k.slabOf(box(r.x + 0.8, r.y + 0.8, r.w - 1.6, 2.2, 0.3), rTop, 5.2, P, 2), { tone: "mid", crease: "lo" });
    const leftWall = S(k.slabOf(box(r.x + 0.8, r.y + 3.0, 2.2, r.d - 18, 0.3), rTop, 5.2, P, 2), { tone: "mid", crease: "lo" });
    const [tx, ty, tw] = r.tag;
    const tag = S(k.slabOf(box(tx, ty, tw, 9, 0.8), rTop, 0.8, P, 2), { tone: "mid", crease: "none" });
    const text = k.faceTextSvg(k.topMatrix([tx + 2.2, ty + 6.4], rTop + 0.8, P, "x"), r.id, { size: 4.4, tone: "hi" });
    const eq = EQPS.find((e) => e.room === r.id);
    const sock = eq ? L(k.ring(eq.x + eq.w / 2, eq.y + eq.d / 2, 3.6, rTop, P, 20), { tone: "mid" }) : "";
    out.push(`<g class="mg-room-g" data-room="${r.id}">${plate}${inner}${sock}${backWall}${leftWall}${tag}${text}</g>`);
  }

  for (const [px, py] of [...POSTS].sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P))) {
    out.push(S(k.cylinder(px, py, 3.6, top, 2.4, P, 20), { tone: "mid" }));
    out.push(S(k.cylinder(px, py, 1.5, top + 2.4, POST_H - top - 2.4, P, 16), { tone: "lo", crease: "none" }));
    out.push(L(k.coil(px, py, 2.6, top + 3.5, top + 18, 5, P), { tone: "mid" }));
    out.push(S(k.cylinder(px, py, 2.5, POST_H, 1.8, P, 18), { tone: "mid" }));
  }
  return out.join("");
}

function mepCarrier() {
  const z0 = 26;
  const fh = 3.6;
  const out = [];
  out.push(S(k.slabOf(box(6, 8, 168, 4.8, 0.8), z0, fh, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(box(6, 101.2, 168, 4.8, 0.8), z0, fh, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(box(6, 12.8, 4.8, 88.4, 0.8), z0, fh, P, 2, 0.4), { tone: "mid" }));
  out.push(S(k.slabOf(box(169.2, 12.8, 4.8, 88.4, 0.8), z0, fh, P, 2, 0.4), { tone: "mid" }));

  for (const [px, py] of POSTS) {
    out.push(S(k.cylinder(px, py, 3.8, z0 - 1.2, fh + 2.4, P, 22, 0.3), { tone: "hi", crease: "lo" }));
    out.push(L(k.ring(px, py, 1.9, z0 + fh + 1.2, P, 16), { tone: "lo" }));
  }

  const ductZ = z0 + fh + 4.2;
  const mainLine = [[32, 28, ductZ], [150, 28, ductZ]];
  for (const piece of tubePieces(mainLine, 2.8, P, { maxLength: 18, spacing: 1.0 })) {
    out.push(tubeSvg(piece, { tone: "hi" }));
  }
  for (const fx of [56, 114]) {
    const F = G.frameAlong([fx, 28, ductZ], [1, 0, 0]);
    out.push(S(G.disc(-0.8, 0.8, 4.4, F, P), { tone: "hi" }));
    out.push(D(G.dotsOf(F, 0.8, 3.5, 6, P, { all: true }), { size: 0.35, tone: "mid" }));
  }

  for (const eq of EQPS) {
    const cx = eq.x + eq.w / 2;
    const cy = eq.y + eq.d / 2;
    out.push(L(k.segment([cx, cy, z0 - 14.5], [cx, cy, z0], P), { tone: "hi", dashed: true }));
    const bobF = G.frameAlong([cx, cy, z0 - 14.5], [0, 0, 1]);
    const bobProf = [[0, 0.3], [1.6, 2.3], [4.2, 2.3], [4.8, 1.0]];
    out.push(S(G.solidOf(bobProf, bobF, P), { tone: "hi", lit: true }));

    const branchLine = G.fillet([[cx, 28, ductZ], [cx, cy, ductZ], [cx, cy, z0 + fh + eq.h]], 3.2, 8, { P, tube: 1.8 });
    for (const piece of tubePieces(branchLine, 1.8, P, { maxLength: 12 })) {
      out.push(tubeSvg(piece, { tone: "mid" }));
    }

    const ez0 = z0 + fh;
    if (eq.big) {
      const p = box(eq.x, eq.y, eq.w, eq.d, 1.2);
      out.push(S(k.slabOf(p, ez0, 2.5, P, 3, 0.4), { tone: "mid" }));
      const vesselF = G.frameAlong([cx, cy, ez0 + 2.5], [0, 0, 1]);
      const vesselProf = [[0, 7.6], [9.5, 7.6], [11.2, 5.2], [12.0, 2.8]];
      out.push(S(G.solidOf(vesselProf, vesselF, P), { tone: "hi", crease: "lo" }));
      out.push(L(G.circleOf(vesselF, 5.5, 7.65, P, 36), { tone: "lo" }));
    } else {
      const diffF = G.frameAlong([cx, cy, ez0], [0, 0, 1]);
      const diffProf = [[0, 6.8], [1.2, 6.8], [4.8, 3.2], [7.5, 3.2]];
      out.push(S(G.solidOf(diffProf, diffF, P), { tone: "hi", crease: "lo" }));
      out.push(L(G.circleOf(diffF, 0.6, 5.0, P, 32), { tone: "lo" }));
    }
  }
  out.push(k.faceTextSvg(k.topMatrix([14, 102.5], z0 + fh, P, "x"), "HVAC.IFC · MEP CARRIER", { size: 3.9, tone: "hi" }));
  return out.join("");
}

function knobPointer(kit, progress) {
  const angle = Math.PI * 0.25 + progress * Math.PI * 1.5;
  const [cx, cy] = KNOB;
  const sx = Math.sin(angle), sy = -Math.cos(angle);
  return kit.lineOnTop([cx + sx * 1.2, cy + sy * 1.2], [cx + sx * KNOB_R, cy + sy * KNOB_R], 9.2, P);
}

const FIRST = STAGES[3];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "아래 받침판에 건축 파일(Arch.ifc)의 방 세 개가 놓여 있고, 코일 스프링이 감긴 네 모서리 가이드 기둥을 따라 위쪽 설비 캐리어(HVAC.ifc)가 내려앉으며 보일러와 디퓨저의 다림추가 각 방 소켓에 꽂히는 모형이다.",
  body: [
    base(),
    archTray(),
    `<g data-part="carrier" transform="${k.translateAlong(P, [FIRST.dx, FIRST.dy, FIRST.dz])}">${mepCarrier()}</g>`,
    `<path data-part="pointer" class="iso-line" data-tone="hi" d="${knobPointer(k, 1)}" style="stroke-width:1.2"/>`,
  ],
});

const CSS = `
.iso{--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace}
html{background:#f2f2ef}html:has(body[data-theme="dark"]){background:#0b0b0b}html[data-embed]{background:transparent}html:has(body[data-theme="light"]),body[data-theme="light"]{color-scheme:light}body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.iso-page{width:100%;margin:0}
.iso-figure{margin:0}
.iso-plate{padding:46px 18px 44px}
.mg-stage{outline:none;touch-action:pan-y;cursor:grab}
.mg-stage:active{cursor:grabbing}
.iso[data-theme="light"]{--anatomy-shade-0:#cfcfcc;--anatomy-shade-1:#d9d9d6;--anatomy-shade-2:#e3e3e0;--anatomy-shade-3:#ececea;--anatomy-mid:#76767c;--anatomy-lo:#a4a4a9;--anatomy-faint:#cdcdd0;--anatomy-muted:#6b6b70;
  --mg-lit-top:#8e8e95;--mg-lit-side:#6e6e75;--mg-lit-edge:#000000}
.iso[data-theme="dark"]{--mg-lit-top:#4a4a4a;--mg-lit-side:#333333;--mg-lit-edge:#ffffff}
.mg-room-g[data-lit] .mg-room>.iso-top{fill:var(--mg-lit-top)}
.mg-room-g[data-lit] .mg-room>.iso-shade{fill:var(--mg-lit-side)}
.mg-room-g[data-lit] .mg-room>.iso-edge{stroke:var(--mg-lit-edge);stroke-width:1.5px}
.mg-steps{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.mg-steps button{font:inherit;font-size:12.5px;line-height:1.3;padding:5px 10px;border:1px solid var(--anatomy-faint);border-radius:6px;background:var(--anatomy-card);color:var(--anatomy-text);cursor:pointer}
.mg-steps button:hover{border-color:var(--anatomy-mid)}
.mg-steps button[aria-pressed="true"]{border-color:var(--anatomy-hi);color:var(--anatomy-strong);font-weight:600}
.mg-note{margin:8px 0 0;padding:7px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:12.5px/1.55 system-ui,sans-serif;color:var(--anatomy-strong)}
.mg-ttl{margin:6px 0 0;padding:8px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:11.5px/1.6 var(--anatomy-mono);color:var(--anatomy-strong);white-space:pre-wrap}
`;

const DATA = { stages: STAGES.map((s) => ({ ...s, readout: readoutOf(s) })), P, KNOB, KNOB_R };

const LIVE = `
const D = ${JSON.stringify(DATA)};
const P = D.P, KNOB = D.KNOB, KNOB_R = D.KNOB_R;
const kit = { lineOnTop };
const knobPointer = ${knobPointer.toString()};
const stage = document.querySelector(".mg-stage");
const carrier = stage.querySelector('[data-part="carrier"]');
const pointer = stage.querySelector('[data-part="pointer"]');
const rooms = [...stage.querySelectorAll(".mg-room-g")];
const buttons = [...document.querySelectorAll(".mg-steps button")];
const readout = document.querySelector("[data-readout]");
const note = document.querySelector("[data-note]");
const ttl = document.querySelector("[data-ttl]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let pick = 3, cx = D.stages[pick].dx, cy = D.stages[pick].dy, cz = D.stages[pick].dz;
let tx = cx, ty = cy, tz = cz;
let frame = 0, last = 0, clock = 0, visible = false, touring = !still.matches, tourAt = 0, idle = 0, dragging = null;

function draw() {
  carrier.setAttribute("transform", translateAlong(P, [cx, cy, cz]));
  const prog = Math.max(0, Math.min(1, 1 - cz / 38));
  pointer.setAttribute("d", knobPointer(kit, prog));
  const aligned = Math.hypot(cx, cy) < 4 && cz < 6;
  const nearOrigin = Math.hypot(cx, cy) < 5 && cz < 16;
  rooms.forEach((g) => {
    const id = g.dataset.room;
    const on = aligned || (nearOrigin && (id === "Utility" || id === "Bedroom 1"));
    g.toggleAttribute("data-lit", on);
  });
}
function select(n) {
  pick = n;
  const s = D.stages[n];
  tx = s.dx; ty = s.dy; tz = s.dz;
  readout.textContent = s.readout;
  note.textContent = s.note;
  ttl.textContent = s.ttl;
  buttons.forEach((b, m) => b.setAttribute("aria-pressed", String(m === n)));
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring && clock - tourAt > 3.8) { tourAt = clock; select((pick + 1) % D.stages.length); }
  const ease = (v, to) => still.matches ? to : (Math.abs(to - v) < 0.05 ? to : v + (to - v) * (1 - Math.exp(-dt / 0.22)));
  cx = ease(cx, tx); cy = ease(cy, ty); cz = ease(cz, tz);
  draw();
  const settled = cx === tx && cy === ty && cz === tz;
  frame = visible && (touring || !settled) ? requestAnimationFrame(tick) : 0;
}
const run = () => { if (!frame && visible) { last = 0; frame = requestAnimationFrame(tick); } else if (!visible) draw(); };
function steer(n) {
  touring = false;
  clearTimeout(idle);
  idle = setTimeout(() => { if (!still.matches) { touring = true; tourAt = clock; run(); } }, 8000);
  select(n);
}
new IntersectionObserver((entries) => { visible = entries[entries.length - 1].isIntersecting; if (visible) run(); }, { rootMargin: "120px 0px" }).observe(stage);

stage.addEventListener("pointerdown", (e) => {
  touring = false;
  clearTimeout(idle);
  dragging = { x0: e.clientX, y0: e.clientY, z0: tz, moved: false };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dy = e.clientY - dragging.y0;
  const dx = e.clientX - dragging.x0;
  if (Math.hypot(dx, dy) > 4) dragging.moved = true;
  const nextZ = Math.max(0, Math.min(38, dragging.z0 - dy * 0.35));
  const ratio = nextZ / 38;
  tz = nextZ;
  tx = -18 * Math.min(1, ratio * 1.4);
  ty = 12 * Math.min(1, ratio * 1.4);
  const idx = nextZ > 26 ? 0 : nextZ > 15 ? 1 : nextZ > 5 ? 2 : 3;
  if (idx !== pick) {
    pick = idx;
    const s = D.stages[idx];
    readout.textContent = s.readout;
    note.textContent = s.note;
    ttl.textContent = s.ttl;
    buttons.forEach((b, m) => b.setAttribute("aria-pressed", String(m === idx)));
  }
  run();
});
stage.addEventListener("pointerup", () => {
  if (dragging && !dragging.moved) steer((pick + 1) % D.stages.length);
  else if (dragging) select(pick);
  dragging = null;
});
buttons.forEach((b, n) => b.addEventListener("click", () => steer(n)));
stage.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); steer((pick + 1) % D.stages.length); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); steer((pick + D.stages.length - 1) % D.stages.length); }
});
select(pick);
draw();
if (parent !== window) document.documentElement.setAttribute("data-embed", "");
const size = () => parent !== window && parent.postMessage({ type: "guide-fig-size", fig: "merge", height: document.documentElement.scrollHeight }, "*");
addEventListener("load", size);
new ResizeObserver(size).observe(document.body);
`;

const KEYS = [
  { mark: "lit", label: "설비 다림추가 안착해 소속이 매칭된 물리존" },
  { mark: "raised", label: "건축 트레이(Arch.ifc)와 상부 설비 캐리어(HVAC.ifc)" },
  { mark: "dashed", label: "보일러·디퓨저에서 내린 수직 다림추" },
];
const CAPTION =
  "건축 모델과 설비(MEP) 모델이 별도 파일로 납품되었을 때, 에디터는 ① 층 이름·표고(Elevation)로 층을 짝짓고 ② 수평 좌표 원점(Δx, Δy)을 정렬한 뒤 ③ 각 설비의 수평 좌표를 같은 층 물리존 외곽선에 투영해 소속(brick:hasLocation)을 계산합니다.";

function page(theme) {
  const plate = k.plateHtml({
    fig: "Fig 1",
    title: "건축·설비 두 파일은 어떻게 합쳐지나",
    hint: "설비 캐리어를 위아래로 드래그하거나 단계 선택",
    readout: readoutOf(FIRST),
    keys: KEYS,
    caption: CAPTION,
    body: `<div class="iso-stage mg-stage" tabindex="0" role="group" aria-label="건축·설비 정합 지그 모형">${svg}</div>`,
  });
  const btns = `<div class="mg-steps" role="group" aria-label="정합 단계">${STAGES.map((s) => `<button type="button" aria-pressed="${s === FIRST}">${s.name}</button>`).join("")}</div>`;
  const extra = `${btns}<p class="mg-note" data-note>${FIRST.note}</p><pre class="mg-ttl" data-ttl>${FIRST.ttl}</pre>`;
  const html = `<style>${CSS}</style>` + plate.replace('<figcaption class="iso-legend">', `${extra}<figcaption class="iso-legend">`);
  return k.pageHtml({ title: "건축·설비 두 파일은 어떻게 합쳐지나", theme, body: html, script: kitScript() + LIVE, width: 760 }).replace('<html lang="en">', '<html lang="ko">');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "merge.html"), page("light"));
writeFileSync(join(OUT, "merge-dark.html"), page("dark"));
console.log("wrote merge.html, merge-dark.html");
