// 가이드 그림 10: 물리존(IfcSpace) · 룸(수동 분할) · 공조존(HVAC Zone) · 계통과 포트(System & Port) 4계층을 수직 가이드 기둥 위에서 분해·조립하며 비교하는 모형이다.
// 다시 만들려면 `node scripts/guide/figures/space-hierarchy/build.mjs` 를 돌린다.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import { springZ } from "../spring.mjs";
import * as G from "../../anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../anatomy/kit/tube.mjs";
import { kitScript } from "../../anatomy/scripts/inline-kit.mjs";
import { LAYERS, readoutOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "..", "public", "guide", "fig");

const WIDTH = 600;
const HEIGHT = 415;
const BASE = { x: -14, y: -14, w: 202, d: 144, r: 6 };
const BASE_H = 8;
const FOOT_H = 5;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [0, 0, 92],
    [180, 122, 92],
  ],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: 50, elevation: 34 },
);

const at = (p) => k.iso(p, P);
const S = (paths, style) => k.solidSvg(paths, style);
const L = (d, style) => k.lineSvg(d, style);
const D = (pts, style) => k.dotsSvg(pts, style);
const box = (x, y, w, d, r = 0.5) => ({ x, y, w, d, r });

function base() {
  const out = [`<path class="iso-halo" d="${k.haloOf(BASE, -BASE_H - FOOT_H, BASE_H, P)}"/>`];
  for (const [x, y] of k.corners(BASE, 18).sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P))) {
    out.push(S(k.cylinder(x, y, 6.8, -BASE_H - FOOT_H, 1.6, P, 24), { tone: "lo" }));
    out.push(S(k.cylinder(x, y, 5.2, -BASE_H - FOOT_H + 1.6, FOOT_H - 1.6, P, 24), { tone: "mid" }));
  }
  out.push(S(k.slabOf(BASE, -BASE_H, BASE_H, P, 8, 1.5), { tone: "lo", inner: L(k.sideSeam(BASE, -3.5, P, 8), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(BASE, 4.5), 0, P), { tone: "faint" }));
  // 4 모서리 가이드 기둥 + 코일 스프링
  for (const [px, py] of [[14, 12], [156, 12], [14, 98], [156, 98]].sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P))) {
    out.push(S(k.cylinder(px, py, 3.2, 0, 2.2, P, 18), { tone: "mid" }));
    const spring = springZ(px, py, 2.3, 3.5, 22, 5, P);
    out.push(L(spring.back, { tone: "lo" }));
    out.push(S(k.cylinder(px, py, 1.4, 2.2, 78, P, 14), { tone: "lo", crease: "none" }));
    out.push(L(spring.front, { tone: "mid" }));
    out.push(S(k.cylinder(px, py, 2.4, 80, 1.8, P, 16), { tone: "mid" }));
  }
  const ruler = box(14, 110, 144, 5, 1);
  out.push(S(k.slabOf(ruler, 0, 0.7, P, 2), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(18, 154, 4, 5, 110, 0.7, [1.6, 3.2], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

function layerPhysical() {
  const p = box(20, 16, 130, 78, 1.5);
  const out = [S(k.slabOf(p, 4, 4.5, P, 4, 0.5), { tone: "hi", crease: "lo", className: "sh-card" })];
  out.push(L(k.planOutline(k.insetPlan(p, 2.5), 8.5, P, 3), { tone: "faint" }));
  // 외벽 턱
  out.push(S(k.slabOf(box(21, 17, 128, 2.2, 0.3), 8.5, 3.8, P, 2), { tone: "mid" }));
  out.push(k.faceTextSvg(k.topMatrix([26, 88], 8.5, P, "x"), "1 · 물리존 (IfcSpace)", { size: 4.4, tone: "hi" }));
  return out.join("");
}

function layerRoom() {
  const out = [];
  const rA = box(24, 20, 58, 66, 1);
  const rB = box(88, 20, 58, 66, 1);
  out.push(S(k.slabOf(rA, 10, 3.2, P, 3, 0.4), { tone: "hi", crease: "lo", className: "sh-card" }));
  out.push(S(k.slabOf(rB, 10, 3.2, P, 3, 0.4), { tone: "hi", crease: "lo", className: "sh-card" }));
  // 중앙 분할 유리 칸막이 날(Partition blade) + 클램프 기둥
  out.push(S(k.slabOf(box(83.5, 19, 3, 68, 0.4), 10, 7.5, P, 2), { tone: "mid", crease: "lo" }));
  out.push(k.faceTextSvg(k.topMatrix([28, 79], 13.2, P, "x"), "2 · 룸 A (분할)", { size: 4.2, tone: "hi" }));
  out.push(k.faceTextSvg(k.topMatrix([92, 79], 13.2, P, "x"), "룸 B (분할)", { size: 4.2, tone: "hi" }));
  return out.join("");
}

function layerHvacZone() {
  const out = [];
  const hz = box(22, 18, 126, 72, 2);
  out.push(S(k.slabOf(box(22, 18, 126, 5, 0.8), 20, 4.5, P, 2), { tone: "hi", crease: "lo", className: "sh-card" }));
  out.push(S(k.slabOf(box(22, 85, 126, 5, 0.8), 20, 4.5, P, 2), { tone: "hi", crease: "lo", className: "sh-card" }));
  out.push(S(k.slabOf(box(22, 23, 5, 62, 0.8), 20, 4.5, P, 2), { tone: "hi", crease: "lo", className: "sh-card" }));
  out.push(S(k.slabOf(box(143, 23, 5, 62, 0.8), 20, 4.5, P, 2), { tone: "hi", crease: "lo", className: "sh-card" }));
  // 써모스탯 센서 유닛 (선반 가공 다이얼)
  out.push(S(k.cylinder(145.5, 52, 3.6, 24.5, 2.2, P, 20), { tone: "hi" }));
  out.push(L(k.planOutline(k.insetPlan(hz, 6), 24.5, P, 3), { tone: "mid", dashed: true }));
  out.push(k.faceTextSvg(k.topMatrix([28, 88.8], 24.5, P, "x"), "3 · 공조존 (HVAC ZONE · IDF)", { size: 4.1, tone: "hi" }));
  return out.join("");
}

function layerSystemPort() {
  const out = [];
  const z0 = 30;
  // VAV 본체 + 컨트롤 박스
  out.push(S(k.slabOf(box(22, 42, 26, 20, 1), z0, 9.5, P, 3, 0.5), { tone: "hi", crease: "lo", className: "sh-card" }));
  // 포트 플랜지 링 (lathe G.disc + 볼트 원)
  const F = G.frameAlong([48, 52, z0 + 5], [1, 0, 0]);
  out.push(S(G.disc(0, 1.8, 5.2, F, P), { tone: "hi" }));
  out.push(D(G.dotsOf(F, 1.8, 4.0, 6, P, { all: true }), { size: 0.36, tone: "mid" }));

  // 3D 원형 주 급기 덕트 (tubePieces)
  const ductLine = [[49.8, 52, z0 + 5], [124, 52, z0 + 5]];
  for (const pc of tubePieces(ductLine, 3.2, P, { maxLength: 16, spacing: 0.9 })) {
    out.push(tubeSvg(pc, { tone: "hi" }));
  }

  // 스펀 콘 디퓨저 2대 (G.solidOf) + 하향 급기 다림추
  for (const dx of [68, 116]) {
    const dF = G.frameAlong([dx, 52, z0 - 2], [0, 0, 1]);
    const prof = [[0, 7.2], [1.4, 7.2], [4.5, 3.2], [7.0, 3.2]];
    out.push(S(G.solidOf(prof, dF, P), { tone: "hi", crease: "lo", className: "sh-card" }));
    out.push(L(G.circleOf(dF, 0.5, 5.2, P, 32), { tone: "lo" }));
    out.push(L(k.segment([dx, 52, z0 - 10], [dx, 52, z0 - 2], P), { tone: "hi", dashed: true }));
  }
  out.push(k.faceTextSvg(k.topMatrix([24, 58], z0 + 9.5, P, "x"), "4 · 계통 · 포트", { size: 4, tone: "hi" }));
  return out.join("");
}

const FIRST = LAYERS[0];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "네 모서리 수직 기둥을 따라 아래부터 1층 물리존(IfcSpace), 2층 수동 분할 룸, 3층 공조존(HVAC Zone), 4층 설비 계통과 포트가 겹쳐진 분해 조립 모형이다.",
  body: [
    base(),
    `<g class="sh-layer" data-i="0" transform="${k.translateAlong(P, [0, 0, FIRST.lift[0]])}">${layerPhysical()}</g>`,
    `<g class="sh-layer" data-i="1" transform="${k.translateAlong(P, [0, 0, FIRST.lift[1]])}">${layerRoom()}</g>`,
    `<g class="sh-layer" data-i="2" transform="${k.translateAlong(P, [0, 0, FIRST.lift[2]])}">${layerHvacZone()}</g>`,
    `<g class="sh-layer" data-i="3" transform="${k.translateAlong(P, [0, 0, FIRST.lift[3]])}">${layerSystemPort()}</g>`,
  ],
});

const CSS = `
.iso{--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace}
html{background:#f2f2ef}html:has(body[data-theme="dark"]){background:#0b0b0b}html[data-embed],html[data-embed]:has(body){background:transparent}html:has(body[data-theme="light"]),body[data-theme="light"]{color-scheme:light}body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.iso-page{width:100%;margin:0}.iso-figure{margin:0}.iso-plate{padding:46px 18px 44px}
.sh-stage{outline:none;touch-action:pan-y;cursor:ns-resize}.sh-layer{cursor:pointer}
.iso[data-theme="light"]{--anatomy-shade-0:#cfcfcc;--anatomy-shade-1:#d9d9d6;--anatomy-shade-2:#e3e3e0;--anatomy-shade-3:#ececea;--anatomy-mid:#76767c;--anatomy-lo:#a4a4a9;--anatomy-faint:#cdcdd0;--anatomy-muted:#6b6b70;
  --sh-lit-top:#8e8e95;--sh-lit-side:#6e6e75;--sh-lit-edge:#000000}
.iso[data-theme="dark"]{--sh-lit-top:#4a4a4a;--sh-lit-side:#333333;--sh-lit-edge:#ffffff}
.sh-layer[data-lit] .sh-card>.iso-top{fill:var(--sh-lit-top)}
.sh-layer[data-lit] .sh-card>.iso-shade{fill:var(--sh-lit-side)}
.sh-layer[data-lit] .sh-card>.iso-edge{stroke:var(--sh-lit-edge);stroke-width:1.6px}
.sh-steps{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.sh-steps button{font:inherit;font-size:12.5px;line-height:1.3;padding:5px 10px;border:1px solid var(--anatomy-faint);border-radius:6px;background:var(--anatomy-card);color:var(--anatomy-text);cursor:pointer}
.sh-steps button[aria-pressed="true"]{border-color:var(--anatomy-hi);color:var(--anatomy-strong);font-weight:600}
.sh-note{margin:8px 0 0;padding:7px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:12.5px/1.55 system-ui,sans-serif;color:var(--anatomy-strong)}
.sh-ttl{margin:6px 0 0;padding:8px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:11.5px/1.6 var(--anatomy-mono);color:var(--anatomy-strong);white-space:pre-wrap}
`;

const DATA = { layers: LAYERS.map((l) => ({ ...l, readout: readoutOf(l) })), P };

const LIVE = `
const D = ${JSON.stringify(DATA)};
const P = D.P;
const stage = document.querySelector(".sh-stage");
const groups = [...stage.querySelectorAll(".sh-layer")];
const buttons = [...document.querySelectorAll(".sh-steps button")];
const readout = document.querySelector("[data-readout]");
const note = document.querySelector("[data-note]");
const ttl = document.querySelector("[data-ttl]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let pick = 0, zs = [...D.layers[0].lift], targetZs = [...zs];
let frame = 0, last = 0, clock = 0, visible = false, touring = !still.matches, tourAt = 0, idle = 0, dragging = null;

function draw() {
  groups.forEach((g, i) => {
    g.setAttribute("transform", translateAlong(P, [0, 0, zs[i]]));
    g.toggleAttribute("data-lit", i === D.layers[pick].litLayer);
  });
}
function select(n) {
  pick = n;
  const l = D.layers[n];
  targetZs = [...l.lift];
  readout.textContent = l.readout;
  note.textContent = l.note;
  ttl.textContent = l.ttl;
  buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === n)));
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring && clock - tourAt > 3.8) { tourAt = clock; select((pick + 1) % D.layers.length); }
  zs = zs.map((v, i) => still.matches ? targetZs[i] : (Math.abs(targetZs[i] - v) < 0.05 ? targetZs[i] : v + (targetZs[i] - v) * (1 - Math.exp(-dt / 0.22))));
  draw();
  const settled = zs.every((v, i) => v === targetZs[i]);
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
  const g = e.target.closest(".sh-layer");
  if (g) { steer(Number(g.dataset.i)); return; }
  dragging = { y0: e.clientY, spread0: targetZs[3] / 34, moved: false };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dy = e.clientY - dragging.y0;
  if (Math.abs(dy) > 4) dragging.moved = true;
  const sp = Math.max(0.15, Math.min(1.35, dragging.spread0 - dy * 0.008));
  targetZs = [0, 10 * sp, 22 * sp, 34 * sp];
  run();
});
stage.addEventListener("pointerup", () => {
  if (dragging && !dragging.moved) steer((pick + 1) % D.layers.length);
  dragging = null;
});
buttons.forEach((b, n) => b.addEventListener("click", () => steer(n)));
stage.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); steer((pick + 1) % D.layers.length); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); steer((pick + D.layers.length - 1) % D.layers.length); }
});
select(pick);
draw();
if (parent !== window) document.documentElement.setAttribute("data-embed", "");
const size = () => parent !== window && parent.postMessage({ type: "guide-fig-size", fig: "space-hierarchy", height: document.documentElement.scrollHeight }, "*");
addEventListener("load", size);
new ResizeObserver(size).observe(document.body);
`;

const KEYS = [
  { mark: "lit", label: "현재 선택한 공간·공조 개념 계층" },
  { mark: "raised", label: "리드스크류 기둥 위에서 분해·조립되는 나머지 계층" },
];
const CAPTION =
  "같은 바닥이라도 건축 BIM에서 온 기본 공간은 [물리존], 사람이 에디터에서 쪼갠 구획은 [룸], 에너지 모델(IDF)에서 온 열제어 구역은 [공조존], 그 위에서 공기와 물을 보내는 배관·덕트 묶음은 [계통]과 [포트]입니다.";

function page(theme) {
  const plate = k.plateHtml({
    fig: "Fig 10",
    title: "물리존 · 룸 · 공조존 · 계통은 서로 어떻게 다른가",
    hint: "계층을 누르거나 위아래로 드래그해 분해 간격 조절",
    readout: readoutOf(FIRST),
    keys: KEYS,
    caption: CAPTION,
    body: `<div class="iso-stage sh-stage" tabindex="0" role="group" aria-label="공간·공조 4계층 분해 모형">${svg}</div>`,
  });
  const btns = `<div class="sh-steps" role="group" aria-label="도메인 계층">${LAYERS.map((l) => `<button type="button" aria-pressed="${l === FIRST}">${l.name}</button>`).join("")}</div>`;
  const extra = `${btns}<p class="sh-note" data-note>${FIRST.note}</p><pre class="sh-ttl" data-ttl>${FIRST.ttl}</pre>`;
  const html = `<style>${CSS}</style>` + plate.replace('<figcaption class="iso-legend">', `${extra}<figcaption class="iso-legend">`);
  return k.pageHtml({ title: "물리존 · 룸 · 공조존 · 계통은 서로 어떻게 다른가", theme, body: html, script: kitScript() + LIVE, width: 760 }).replace('<html lang="en">', '<html lang="ko">');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "space-hierarchy.html"), page("light"));
writeFileSync(join(OUT, "space-hierarchy-dark.html"), page("dark"));
console.log("wrote space-hierarchy.html, space-hierarchy-dark.html");
