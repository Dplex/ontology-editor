// 가이드 그림 2: 바닥 외곽선(Footprint) 유무에 따른 3D 공간 표시·설비 소속 판정 차이와 공간 편집 보정을 보이는 검수대 모형이다.
// 다시 만들려면 `node scripts/guide/figures/footprint/build.mjs` 를 돌린다.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import * as G from "../../anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../anatomy/kit/tube.mjs";
import { kitScript } from "../../anatomy/scripts/inline-kit.mjs";
import { MODES, readoutOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "..", "public", "guide", "fig");

const WIDTH = 600;
const HEIGHT = 395;
const BASE = { x: -12, y: -14, w: 206, d: 148, r: 6 };
const BASE_H = 8;
const FOOT_H = 5;

const LEFT_ROOM = { x: 8, y: 16, w: 48, d: 78, r: 1.2 };
const MID_ROOM = { x: 64, y: 16, w: 52, d: 78, r: 1.2 };
const RIGHT_ROOM = { x: 124, y: 16, w: 48, d: 78, r: 1.2 };
const RULER = { x: 8, y: 108, w: 120, d: 5, r: 1 };
const CONSOLE = { x: 134, y: 104, w: 46, d: 18, r: 2 };
const KNOB = [166, 113];
const KNOB_R = 4.8;
const DIAL_R = 7.6;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [0, 0, 64],
    [186, 124, 64],
  ],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: 50, elevation: 35 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const box = (x, y, w, d, r = 0.5) => ({ x, y, w, d, r });
const faceRect = (corners) => `M${corners.map((p) => at(p).map((v) => v.toFixed(1)).join(" ")).join("L")}Z`;

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of k.corners(BASE, 18).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P))) {
    out.push(S(k.cylinder(x, y, 6.8, -BASE_H - FOOT_H, 1.6, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.2, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 24), { tone: "mid" }));
  }
  out.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.5), { tone: "lo", inner: L(k.sideSeam(BASE, -3.5, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(BASE, 4.5), 0, P), { tone: "faint" }));

  // 가운데 빈 우물 바닥의 5m 격자 및 리프트 코일 스프링 4개
  const grid = [];
  for (let gx = 68; gx <= 112; gx += 11) grid.push(k.lineOnTop([gx, 18], [gx, 92], 0, P));
  for (let gy = 26; gy <= 86; gy += 15) grid.push(k.lineOnTop([66, gy], [114, gy], 0, P));
  out.push(L(grid.join(""), { tone: "faint" }));

  const screws = k.corners(BASE, 9);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2, 0, P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.48 }));
  out.push(S(k.slabOf(RULER, 0, 0.7, P, 2), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(RULER.x + 4, RULER.x + RULER.w - 4, 4, 5, RULER.y, 0.7, [1.6, 3.2], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));

  // 폴리곤 클로저 노브 콘솔
  const cTop = 4.0;
  out.push(S(k.slabOf(CONSOLE, 0, cTop, P, 4, 0.5), { tone: "mid" }));
  out.push(L(k.planOutline(k.insetPlan(CONSOLE, 2), cTop, P, 3), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([CONSOLE.x + 3.5, CONSOLE.y + 11], cTop, P, "x"), "외곽선", { size: 3.6, tone: "hi" }));
  const [kx, ky] = KNOB;
  out.push(L(k.ring(kx, ky, DIAL_R, cTop, P, 48), { tone: "lo" }));
  const rTicks = k.radialTicks(kx, ky, DIAL_R, 10, 5, cTop, [1.0, 1.8], P, Math.PI * 0.25, Math.PI * 1.5);
  out.push(L(rTicks.minor, { tone: "lo" }), L(rTicks.major, { tone: "mid" }));
  out.push(S(k.cylinder(kx, ky, KNOB_R + 0.6, cTop, 1.1, P, 28), { tone: "lo" }));
  out.push(S(k.cylinder(kx, ky, KNOB_R, cTop + 1.1, 3.6, P, 28, 0.4), { tone: "hi" }));
  out.push(L(k.knurl(kx, ky, KNOB_R, cTop + 1.3, cTop + 4.5, 28, P), { tone: "lo" }));
  return out.join("");
}

function neighborRooms() {
  const out = [];
  for (const [rm, title] of [[LEFT_ROOM, "대기실"], [RIGHT_ROOM, "복도"]]) {
    out.push(S(k.slabOf(rm, 0, 3.8, P, 3, 0.5), { tone: "mid", crease: "lo" }));
    out.push(L(k.planOutline(k.insetPlan(rm, 2.2), 3.8, P, 2), { tone: "faint" }));
    out.push(S(k.slabOf(box(rm.x + 0.8, rm.y + 0.8, rm.w - 1.6, 2.2, 0.3), 3.8, 4.5, P, 2), { tone: "mid", crease: "lo" }));
    out.push(k.faceTextSvg(k.topMatrix([rm.x + 6, rm.y + rm.d - 8], 3.8, P, "x"), title, { size: 4.8, tone: "hi" }));
  }
  out.push(L(k.planOutline(MID_ROOM, 0, P, 2), { tone: "mid", dashed: true }));

  // 네 모서리 선반 가공 꼭짓점 기둥 핀(P1~P4) + 레이저 트레이스 링
  const corners = k.corners(MID_ROOM, 1.5);
  corners.forEach(([cx, cy], idx) => {
    const F = G.frameAlong([cx, cy, 0], [0, 0, 1]);
    const prof = [[0, 3.2], [1.2, 3.2], [1.6, 2.0], [5.2, 2.0], [6.4, 2.8], [7.2, 1.2]];
    out.push(`<g class="fp-pin" data-pin="${idx}">${S(G.solidOf(prof, F, P), { tone: "hi", crease: "lo" })}${D([at([cx, cy, 7.2])], { size: 0.6, tone: "hi" })}</g>`);
  });
  return out.join("");
}

function midSlab() {
  const out = [];
  out.push(S(k.slabOf(MID_ROOM, 0, 3.8, P, 3, 0.5), { tone: "hi", crease: "lo", className: "fp-slab" }));
  out.push(L(k.planOutline(k.insetPlan(MID_ROOM, 2.2), 3.8, P, 2), { tone: "faint" }));
  out.push(S(k.slabOf(box(MID_ROOM.x + 0.8, MID_ROOM.y + 0.8, MID_ROOM.w - 1.6, 2.2, 0.3), 3.8, 4.5, P, 2), { tone: "mid", crease: "lo" }));
  const cx = MID_ROOM.x + MID_ROOM.w / 2;
  const cy = MID_ROOM.y + MID_ROOM.d / 2;
  out.push(L(k.ring(cx, cy, 4.2, 3.8, P, 24), { tone: "hi" }));
  const tag = box(MID_ROOM.x + 8, MID_ROOM.y + MID_ROOM.d - 16, 36, 9, 0.8);
  out.push(S(k.slabOf(tag, 3.8, 0.9, P, 2), { tone: "mid", crease: "none" }));
  out.push(k.faceTextSvg(k.topMatrix([tag.x + 2.5, tag.y + 6.5], 4.7, P, "x"), "회의실 B204", { size: 4.5, tone: "hi" }));
  return out.join("");
}

function gantryAndFcu() {
  const out = [];
  for (const px of [32, 148]) {
    out.push(S(k.cylinder(px, 6, 4.6, 0, 2, P, 20), { tone: "lo" }));
    out.push(S(k.cylinder(px, 6, 3.0, 2, 44, P, 20), { tone: "mid", crease: "none" }));
    out.push(L(k.sideArc(px, 6, 3.0, 22, P, 16), { tone: "faint" }));
  }
  out.push(S(k.slabOf(box(26, 3, 128, 6.5, 0.8), 46, 3.8, P, 2, 0.4), { tone: "mid" }));

  const cx = MID_ROOM.x + MID_ROOM.w / 2;
  const cy = MID_ROOM.y + MID_ROOM.d / 2;
  out.push(S(k.slabOf(box(cx - 3.2, 6, 6.4, cy + 8, 0.6), 49.8, 3.0, P, 2, 0.4), { tone: "mid" }));

  // 냉수 급·환수 연결 배관 (tube.mjs tubePieces)
  const pipeLine = G.fillet([[36, 6, 48], [cx - 8, 6, 48], [cx - 8, cy, 48], [cx - 8, cy, 42]], 4, 8, { P, tube: 1.6 });
  for (const piece of tubePieces(pipeLine, 1.6, P, { maxLength: 14 })) {
    out.push(tubeSvg(piece, { tone: "mid" }));
  }

  // 다림추 줄과 선반 가공 황동 다림추 (lathe solidOf)
  out.push(L(k.segment([cx, cy, 4.2], [cx, cy, 38], P), { tone: "hi", dashed: true }));
  const bobF = G.frameAlong([cx, cy, 4.2], [0, 0, 1]);
  const bobProf = [[0, 0.3], [1.6, 2.6], [4.5, 2.6], [5.4, 1.0]];
  out.push(S(G.solidOf(bobProf, bobF, P), { tone: "hi", lit: true }));

  // 정밀 FCU 본체 (전면 송풍 루버 슬롯 + 측면 점검 해치 + 상부 행거 볼트)
  const fcuBox = box(cx - 14, cy - 10, 28, 20, 1);
  const yFace = fcuBox.y + fcuBox.d;
  const slots = [];
  for (let i = 0; i < 4; i++) {
    const zz = 39.2 + i * 1.6;
    slots.push(faceRect([[fcuBox.x + 2.5, yFace, zz], [fcuBox.x + fcuBox.w - 2.5, yFace, zz], [fcuBox.x + fcuBox.w - 2.5, yFace, zz + 0.6], [fcuBox.x + 2.5, yFace, zz + 0.6]]));
  }
  out.push(S(k.slabOf(fcuBox, 38, 8.8, P, 3, 0.6), { tone: "hi", crease: "lo", inner: L(slots.join(""), { tone: "lo" }) }));
  out.push(k.faceTextSvg(k.topMatrix([fcuBox.x + 3.5, fcuBox.y + 13], 46.8, P, "x"), "FCU_204", { size: 4.2, tone: "hi" }));
  return out.join("");
}

function knobPointer(kit, prog) {
  const angle = Math.PI * 0.25 + prog * Math.PI * 1.5;
  const [cx, cy] = KNOB;
  const sx = Math.sin(angle), sy = -Math.cos(angle);
  return kit.lineOnTop([cx + sx * 1.1, cy + sy * 1.1], [cx + sx * KNOB_R, cy + sy * KNOB_R], 8.7, P);
}

const FIRST = MODES[2];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "양옆에 대기실과 복도 바닥판이 놓여 있고, 가운데 회의실 B204 자리 위에는 FCU_204가 다림추를 내리고 있다. 네 모서리 꼭짓점 핀(P1~P4)으로 바닥 외곽선을 닫으면 바닥판이 올라와 다림추를 받아낸다.",
  body: [
    base(),
    neighborRooms(),
    `<g data-part="slab" transform="${k.translateAlong(P, [0, 0, FIRST.slabZ])}">${midSlab()}</g>`,
    gantryAndFcu(),
    `<path data-part="pointer" class="iso-line" data-tone="hi" d="${knobPointer(k, 1)}" style="stroke-width:1.2"/>`,
  ],
});

const CSS = `
.iso{--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace}
html{background:#f2f2ef}html:has(body[data-theme="dark"]){background:#0b0b0b}html[data-embed]{background:transparent}html:has(body[data-theme="light"]),body[data-theme="light"]{color-scheme:light}body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.iso-page{width:100%;margin:0}.iso-figure{margin:0}.iso-plate{padding:46px 18px 44px}
.fp-stage{outline:none;touch-action:pan-y;cursor:grab}
.fp-stage:active{cursor:grabbing}
.fp-pin{cursor:pointer}
.iso[data-theme="light"]{--anatomy-shade-0:#cfcfcc;--anatomy-shade-1:#d9d9d6;--anatomy-shade-2:#e3e3e0;--anatomy-shade-3:#ececea;--anatomy-mid:#76767c;--anatomy-lo:#a4a4a9;--anatomy-faint:#cdcdd0;--anatomy-muted:#6b6b70;
  --fp-lit-top:#8e8e95;--fp-lit-side:#6e6e75;--fp-lit-edge:#000000}
.iso[data-theme="dark"]{--fp-lit-top:#4a4a4a;--fp-lit-side:#333333;--fp-lit-edge:#ffffff}
[data-part="slab"][data-lit] .fp-slab>.iso-top{fill:var(--fp-lit-top)}
[data-part="slab"][data-lit] .fp-slab>.iso-shade{fill:var(--fp-lit-side)}
[data-part="slab"][data-lit] .fp-slab>.iso-edge{stroke:var(--fp-lit-edge);stroke-width:1.6px}
.fp-steps{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.fp-steps button{font:inherit;font-size:12.5px;line-height:1.3;padding:5px 10px;border:1px solid var(--anatomy-faint);border-radius:6px;background:var(--anatomy-card);color:var(--anatomy-text);cursor:pointer}
.fp-steps button[aria-pressed="true"]{border-color:var(--anatomy-hi);color:var(--anatomy-strong);font-weight:600}
.fp-note{margin:8px 0 0;padding:7px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:12.5px/1.55 system-ui,sans-serif;color:var(--anatomy-strong)}
.fp-ttl{margin:6px 0 0;padding:8px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:11.5px/1.6 var(--anatomy-mono);color:var(--anatomy-strong);white-space:pre-wrap}
`;

const DATA = { modes: MODES.map((m) => ({ ...m, readout: readoutOf(m) })), P, KNOB, KNOB_R };

const LIVE = `
const D = ${JSON.stringify(DATA)};
const P = D.P, KNOB = D.KNOB, KNOB_R = D.KNOB_R;
const kit = { lineOnTop };
const knobPointer = ${knobPointer.toString()};
const stage = document.querySelector(".fp-stage");
const slab = stage.querySelector('[data-part="slab"]');
const pointer = stage.querySelector('[data-part="pointer"]');
const buttons = [...document.querySelectorAll(".fp-steps button")];
const readout = document.querySelector("[data-readout]");
const note = document.querySelector("[data-note]");
const ttl = document.querySelector("[data-ttl]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let pick = 2, sz = D.modes[pick].slabZ, tz = sz;
let frame = 0, last = 0, clock = 0, visible = false, touring = !still.matches, tourAt = 0, idle = 0, dragging = null;

function draw() {
  slab.setAttribute("transform", translateAlong(P, [0, 0, sz]));
  slab.style.opacity = Math.max(0.16, Math.min(1, 1 + sz / 16)).toFixed(2);
  slab.toggleAttribute("data-lit", Math.abs(sz) < 1.8);
  const prog = Math.max(0, Math.min(1, (sz + 14) / 14));
  pointer.setAttribute("d", knobPointer(kit, prog));
}
function select(n) {
  pick = n;
  const m = D.modes[n];
  tz = m.slabZ;
  readout.textContent = m.readout;
  note.textContent = m.note;
  ttl.textContent = m.ttl;
  buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === n)));
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring && clock - tourAt > 3.8) { tourAt = clock; select((pick + 1) % D.modes.length); }
  sz = still.matches ? tz : (Math.abs(tz - sz) < 0.05 ? tz : sz + (tz - sz) * (1 - Math.exp(-dt / 0.22)));
  draw();
  frame = visible && (touring || sz !== tz) ? requestAnimationFrame(tick) : 0;
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
  dragging = { y0: e.clientY, z0: tz, moved: false };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dy = e.clientY - dragging.y0;
  if (Math.abs(dy) > 4) dragging.moved = true;
  tz = Math.max(-14, Math.min(0, dragging.z0 - dy * 0.18));
  const idx = tz < -10 ? 0 : tz < -2.5 ? 1 : 2;
  if (idx !== pick) {
    pick = idx;
    const m = D.modes[idx];
    readout.textContent = m.readout;
    note.textContent = m.note;
    ttl.textContent = m.ttl;
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === idx)));
  }
  run();
});
stage.addEventListener("pointerup", () => {
  if (dragging && !dragging.moved) steer((pick + 1) % D.modes.length);
  else if (dragging) select(pick);
  dragging = null;
});
buttons.forEach((b, n) => b.addEventListener("click", () => steer(n)));
stage.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); steer((pick + 1) % D.modes.length); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); steer((pick + D.modes.length - 1) % D.modes.length); }
});
select(pick);
draw();
if (parent !== window) document.documentElement.setAttribute("data-embed", "");
const size = () => parent !== window && parent.postMessage({ type: "guide-fig-size", fig: "footprint", height: document.documentElement.scrollHeight }, "*");
addEventListener("load", size);
new ResizeObserver(size).observe(document.body);
`;

const KEYS = [
  { mark: "lit", label: "외곽선이 닫혀 3D 프리즘과 설비 소속이 활성화된 물리존" },
  { mark: "dashed", label: "외곽선이 빠진 빈 경계와 허공으로 떨어지는 다림추" },
  { mark: "raised", label: "선반 가공 꼭짓점 핀(P1~P4)과 상부 FCU" },
];
const CAPTION =
  "물리존(IfcSpace)은 바닥 외곽선(2D 폴리곤)이 있어야 3D 공간으로 올라오고 위쪽 설비의 다림추를 받아낼 수 있습니다. 외곽선이 누락된 공간은 [공간 편집]에서 모서리를 찍어 그리면 고객사 재제출 없이 즉시 3D와 설비 소속 판정에 반영됩니다.";

function page(theme) {
  const plate = k.plateHtml({
    fig: "Fig 2",
    title: "바닥 외곽선이 왜 있어야 하나",
    hint: "모서리 핀이나 슬래브를 위아래로 드래그해 보정 보기",
    readout: readoutOf(FIRST),
    keys: KEYS,
    caption: CAPTION,
    body: `<div class="iso-stage fp-stage" tabindex="0" role="group" aria-label="바닥 외곽선 검수대 모형">${svg}</div>`,
  });
  const btns = `<div class="fp-steps" role="group" aria-label="외곽선 상태">${MODES.map((m) => `<button type="button" aria-pressed="${m === FIRST}">${m.name}</button>`).join("")}</div>`;
  const extra = `${btns}<p class="fp-note" data-note>${FIRST.note}</p><pre class="fp-ttl" data-ttl>${FIRST.ttl}</pre>`;
  const html = `<style>${CSS}</style>` + plate.replace('<figcaption class="iso-legend">', `${extra}<figcaption class="iso-legend">`);
  return k.pageHtml({ title: "바닥 외곽선이 왜 있어야 하나", theme, body: html, script: kitScript() + LIVE, width: 760 }).replace('<html lang="en">', '<html lang="ko">');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "footprint.html"), page("light"));
writeFileSync(join(OUT, "footprint-dark.html"), page("dark"));
console.log("wrote footprint.html, footprint-dark.html");
