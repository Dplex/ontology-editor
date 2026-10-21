// 가이드 그림 3: 층별 슬래브 적층 구조와 2D 평면도 수평 단면 슬라이서(Shift+V)를 보이는 모형이다.
// 다시 만들려면 `node scripts/guide/figures/viewport/build.mjs` 를 돌린다.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import * as G from "../../anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../anatomy/kit/tube.mjs";
import { kitScript } from "../../anatomy/scripts/inline-kit.mjs";
import { VIEWS, readoutOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "..", "public", "guide", "fig");

const WIDTH = 600;
const HEIGHT = 390;
const BASE = { x: -12, y: -12, w: 204, d: 142, r: 6 };
const BASE_H = 8;
const FOOT_H = 5;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [0, 0, 72],
    [184, 122, 72],
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

  // 4개의 정밀 리드스크류 기둥 + 코일 스프링
  for (const [px, py] of [[12, 12], [160, 12], [12, 98], [160, 98]].sort((a, b) => k.depthOf([...a, 0], P) - k.depthOf([...b, 0], P))) {
    out.push(S(k.cylinder(px, py, 3.4, 0, 2.2, P, 18), { tone: "mid" }));
    out.push(S(k.cylinder(px, py, 1.5, 2.2, 58, P, 14), { tone: "lo", crease: "none" }));
    out.push(L(k.coil(px, py, 2.3, 3.5, 16, 4, P), { tone: "mid" }));
    out.push(S(k.cylinder(px, py, 2.6, 60, 2.0, P, 18), { tone: "mid" }));
  }

  // 층간 수직 입상 배관 (tubePieces)
  const riserLine = [[26, 22, 2], [26, 22, 54]];
  for (const piece of tubePieces(riserLine, 2.1, P, { maxLength: 16 })) {
    out.push(tubeSvg(piece, { tone: "mid" }));
  }

  // 앞쪽 눈금자
  const ruler = box(10, 112, 148, 5, 1);
  out.push(S(k.slabOf(ruler, 0, 0.7, P, 2), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(14, 154, 4, 5, 112, 0.7, [1.6, 3.2], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

function storeyTray(idx, z0, label) {
  const p = box(20, 16, 132, 78, 1.4);
  const out = [];
  out.push(S(k.slabOf(p, z0, 3.5, P, 3, 0.5), { tone: "hi", crease: "lo", className: "vp-slab" }));
  // 내부 방 칸막이 벽·문 개구부·설비(선반 가공 FCU/디퓨저)
  out.push(S(k.slabOf(box(24, 20, 56, 68, 0.8), z0 + 3.5, 4.8, P, 2), { tone: "mid", crease: "lo" }));
  out.push(S(k.slabOf(box(86, 20, 60, 68, 0.8), z0 + 3.5, 4.8, P, 2), { tone: "mid", crease: "lo" }));
  // 각 방 안의 원통형 설비와 배관
  for (const ex of [52, 116]) {
    const F = G.frameAlong([ex, 52, z0 + 4.5], [0, 0, 1]);
    out.push(S(G.solidOf([[0, 5.5], [1.4, 5.5], [3.8, 2.8], [5.2, 2.8]], F, P), { tone: "hi", crease: "lo" }));
  }
  out.push(k.faceTextSvg(k.topMatrix([28, 82], z0 + 8.3, P, "x"), label, { size: 4.4, tone: "hi" }));
  return `<g class="vp-st" data-i="${idx}">${out.join("")}</g>`;
}

function blade() {
  const out = [];
  const f = box(10, 10, 152, 90, 2);
  // 4 모서리 슬라이딩 부싱 (G.disc)
  for (const [px, py] of [[12, 12], [160, 12], [12, 98], [160, 98]]) {
    out.push(S(k.cylinder(px, py, 3.5, -0.8, 4.2, P, 18), { tone: "hi", lit: true }));
  }
  out.push(S(k.slabOf(box(10, 10, 152, 4.2, 0.6), 0, 2.6, P, 2), { tone: "hi", lit: true }));
  out.push(S(k.slabOf(box(10, 95.8, 152, 4.2, 0.6), 0, 2.6, P, 2), { tone: "hi", lit: true }));
  out.push(S(k.slabOf(box(10, 14.2, 4.2, 81.6, 0.6), 0, 2.6, P, 2), { tone: "hi", lit: true }));
  out.push(S(k.slabOf(box(157.8, 14.2, 4.2, 81.6, 0.6), 0, 2.6, P, 2), { tone: "hi", lit: true }));
  // 우측 단면 높이 조절 널링 핸들
  out.push(S(k.cylinder(168, 55, 5.2, -0.5, 4.0, P, 28, 0.4), { tone: "hi", lit: true }));
  out.push(L(k.knurl(168, 55, 5.2, -0.2, 3.2, 24, P), { tone: "lo" }));
  out.push(L(k.planOutline(k.insetPlan(f, 5), 2.6, P, 3), { tone: "hi", dashed: true }));
  out.push(k.faceTextSvg(k.topMatrix([18, 99], 2.6, P, "x"), "SECTION CUT · 2D ORTHO PLANE (SHIFT+V)", { size: 3.8, tone: "hi" }));
  return out.join("");
}

const FIRST = VIEWS[1];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "네 리드스크류 기둥 사이에 Level 1 과 Level 2 층 슬래브가 위아래로 놓여 있고, 수평 절단 프레임(Section Cut)이 오르내리며 3D 시점과 2D 평면도 시점을 전환하는 모형이다.",
  body: [
    base(),
    storeyTray(0, 4, "LEVEL 1 · EL 0.0m"),
    storeyTray(1, 22, "LEVEL 2 · EL +3.1m"),
    `<g data-part="blade" transform="${k.translateAlong(P, [0, 0, FIRST.bladeZ])}">${blade()}</g>`,
  ],
});

const CSS = `
.iso{--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace}
html{background:#f2f2ef}html:has(body[data-theme="dark"]){background:#0b0b0b}html[data-embed]{background:transparent}html:has(body[data-theme="light"]),body[data-theme="light"]{color-scheme:light}body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.iso-page{width:100%;margin:0}.iso-figure{margin:0}.iso-plate{padding:46px 18px 44px}
.vp-stage{outline:none;touch-action:pan-y;cursor:ns-resize}
.iso[data-theme="light"]{--anatomy-shade-0:#cfcfcc;--anatomy-shade-1:#d9d9d6;--anatomy-shade-2:#e3e3e0;--anatomy-shade-3:#ececea;--anatomy-mid:#76767c;--anatomy-lo:#a4a4a9;--anatomy-faint:#cdcdd0;--anatomy-muted:#6b6b70;
  --vp-lit-top:#8e8e95;--vp-lit-side:#6e6e75;--vp-lit-edge:#000000}
.iso[data-theme="dark"]{--vp-lit-top:#4a4a4a;--vp-lit-side:#333333;--vp-lit-edge:#ffffff}
.vp-st[data-lit] .vp-slab>.iso-top{fill:var(--vp-lit-top)}
.vp-st[data-lit] .vp-slab>.iso-shade{fill:var(--vp-lit-side)}
.vp-st[data-lit] .vp-slab>.iso-edge{stroke:var(--vp-lit-edge);stroke-width:1.6px}
.vp-steps{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.vp-steps button{font:inherit;font-size:12.5px;line-height:1.3;padding:5px 10px;border:1px solid var(--anatomy-faint);border-radius:6px;background:var(--anatomy-card);color:var(--anatomy-text);cursor:pointer}
.vp-steps button[aria-pressed="true"]{border-color:var(--anatomy-hi);color:var(--anatomy-strong);font-weight:600}
.vp-note{margin:8px 0 0;padding:7px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:12.5px/1.55 system-ui,sans-serif;color:var(--anatomy-strong)}
`;

const DATA = { views: VIEWS.map((v) => ({ ...v, readout: readoutOf(v) })), P };

const LIVE = `
const D = ${JSON.stringify(DATA)};
const P = D.P;
const stage = document.querySelector(".vp-stage");
const blade = stage.querySelector('[data-part="blade"]');
const sts = [...stage.querySelectorAll(".vp-st")];
const buttons = [...document.querySelectorAll(".vp-steps button")];
const readout = document.querySelector("[data-readout]");
const note = document.querySelector("[data-note]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let pick = 1, bz = D.views[pick].bladeZ, tz = bz;
let frame = 0, last = 0, clock = 0, visible = false, touring = !still.matches, tourAt = 0, idle = 0, dragging = null;

function draw() {
  blade.setAttribute("transform", translateAlong(P, [0, 0, bz]));
  // 절단면이 1층으로 내려가면 2층 슬래브를 위로 들어올려 시야를 열어 준다!
  const lift2 = Math.max(0, (18 - bz) * 1.15);
  sts[1].setAttribute("transform", translateAlong(P, [0, 0, lift2]));
  sts[1].style.opacity = bz < 16 ? "0.42" : "1";
  const activeStorey = bz < 17 ? 0 : 1;
  sts.forEach((g, i) => g.toggleAttribute("data-lit", i === activeStorey));
}
function select(n) {
  pick = n;
  const v = D.views[n];
  tz = v.bladeZ;
  readout.textContent = v.readout;
  note.textContent = v.note;
  buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === n)));
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring && clock - tourAt > 3.8) { tourAt = clock; select((pick + 1) % D.views.length); }
  bz = still.matches ? tz : (Math.abs(tz - bz) < 0.08 ? tz : bz + (tz - bz) * (1 - Math.exp(-dt / 0.22)));
  draw();
  frame = visible && (touring || bz !== tz) ? requestAnimationFrame(tick) : 0;
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
  tz = Math.max(8, Math.min(46, dragging.z0 - dy * 0.28));
  const idx = tz > 34 ? 0 : tz > 17 ? 1 : 2;
  if (idx !== pick) {
    pick = idx;
    const v = D.views[idx];
    readout.textContent = v.readout;
    note.textContent = v.note;
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === idx)));
  }
  run();
});
stage.addEventListener("pointerup", () => {
  if (dragging && !dragging.moved) steer((pick + 1) % D.views.length);
  else if (dragging) select(pick);
  dragging = null;
});
buttons.forEach((b, n) => b.addEventListener("click", () => steer(n)));
stage.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); steer((pick + 1) % D.views.length); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); steer((pick + D.views.length - 1) % D.views.length); }
});
select(pick);
draw();
if (parent !== window) document.documentElement.setAttribute("data-embed", "");
const size = () => parent !== window && parent.postMessage({ type: "guide-fig-size", fig: "viewport", height: document.documentElement.scrollHeight }, "*");
addEventListener("load", size);
new ResizeObserver(size).observe(document.body);
`;

const KEYS = [
  { mark: "lit", label: "현재 단면이 걸린 활성 층 슬래브와 절단 블레이드(Section Cut)" },
  { mark: "raised", label: "리드스크류 기둥을 따라 분리된 상·하부 층 슬래브" },
];
const CAPTION =
  "3D 시점은 층간 설비 배치와 수직 배관을 입체로 볼 때 쓰고, 평면도(Shift+V)는 선택한 층 높이에 수평 절단면을 내려 원근 왜곡 없이 방 외곽선과 벽·문 위치를 정밀하게 편집할 때 씁니다.";

function page(theme) {
  const plate = k.plateHtml({
    fig: "Fig 3",
    title: "3D 시점과 2D 평면도(층별 단면)는 어떻게 전환되나",
    hint: "단면 프레임을 위아래로 드래그해 층별 슬라이스 보기",
    readout: readoutOf(FIRST),
    keys: KEYS,
    caption: CAPTION,
    body: `<div class="iso-stage vp-stage" tabindex="0" role="group" aria-label="3D·평면도 단면 전환 모형">${svg}</div>`,
  });
  const btns = `<div class="vp-steps" role="group" aria-label="시점 모드">${VIEWS.map((v) => `<button type="button" aria-pressed="${v === FIRST}">${v.name}</button>`).join("")}</div>`;
  const extra = `${btns}<p class="vp-note" data-note>${FIRST.note}</p>`;
  const html = `<style>${CSS}</style>` + plate.replace('<figcaption class="iso-legend">', `${extra}<figcaption class="iso-legend">`);
  return k.pageHtml({ title: "3D 시점과 2D 평면도는 어떻게 전환되나", theme, body: html, script: kitScript() + LIVE, width: 760 }).replace('<html lang="en">', '<html lang="ko">');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "viewport.html"), page("light"));
writeFileSync(join(OUT, "viewport-dark.html"), page("dark"));
console.log("wrote viewport.html, viewport-dark.html");
