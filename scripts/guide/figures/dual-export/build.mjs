// 가이드 그림 6: 하나의 편집 모델에서 GeoJSON(기하) 판과 Brick TTL(의미) 판이 나뉘고, 가운데 공유 ID 커플러 핀이 두 출력을 1:1로 잠그는 모형이다.
// 다시 만들려면 `node scripts/guide/figures/dual-export/build.mjs` 를 돌린다.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import * as G from "../../anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../anatomy/kit/tube.mjs";
import { kitScript } from "../../anatomy/scripts/inline-kit.mjs";
import { ITEMS, readoutOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "..", "public", "guide", "fig");

const WIDTH = 600;
const HEIGHT = 390;
const BASE = { x: -12, y: -10, w: 206, d: 142, r: 6 };
const BASE_H = 8;
const FOOT_H = 5;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [0, 0, 52],
    [188, 124, 52],
  ],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: 48, elevation: 35 },
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
  const screws = k.corners(BASE, 9);
  out.push(L(screws.map(([x, y]) => k.ring(x, y, 2, 0, P, 14)).join(""), { tone: "lo" }));
  out.push(D(screws.map(([x, y]) => at([x, y, 0])), { size: 0.48 }));
  const ruler = box(10, 114, 160, 5, 1);
  out.push(S(k.slabOf(ruler, 0, 0.7, P, 2), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(14, 166, 4, 5, 114, 0.7, [1.6, 3.2], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

function platens() {
  const out = [];
  // 왼쪽: GeoJSON 기하 프레스 다이
  const left = box(6, 8, 66, 100, 2);
  out.push(S(k.slabOf(left, 0, 4.8, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(left, 2.2, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(left, 2.2), 4.8, P, 3), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([12, 103], 4.8, P, "x"), "GEOJSON · 기하 형상", { size: 4, tone: "hi" }));

  // 오른쪽: Brick TTL 의미 프레스 다이
  const right = box(108, 8, 66, 100, 2);
  out.push(S(k.slabOf(right, 0, 4.8, P, 4, 0.6), { tone: "mid", inner: L(k.sideSeam(right, 2.2, P, 4), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(right, 2.2), 4.8, P, 3), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([114, 103], 4.8, P, "x"), "BRICK TTL · 의미 관계", { size: 4, tone: "hi" }));

  // 가운데 선반 가공 스플라인 샤프트 레일 + 양 끝 베어링 블록
  out.push(S(k.slabOf(box(84, 6, 12, 5, 0.8), 0, 9.5, P, 2), { tone: "mid" }));
  const railLine = [[90, 11, 6.2], [90, 103, 6.2]];
  for (const pc of tubePieces(railLine, 2.1, P, { maxLength: 18 })) {
    out.push(tubeSvg(pc, { tone: "mid" }));
  }
  out.push(S(k.slabOf(box(84, 103, 12, 5, 0.8), 0, 9.5, P, 2), { tone: "mid" }));

  ITEMS.forEach((it, idx) => {
    const y0 = it.y - 10;
    // 왼쪽 기하 블록 + 상부 형상 조각(Polygon 프리즘 / 보일러 실린더 / 문 프레임)
    const gBox = box(14, y0, 50, 22, 1);
    const gBlock = S(k.slabOf(gBox, 4.8, 6.5, P, 3, 0.5), { tone: "hi", crease: "lo", className: "dx-card" });
    const gIn = L(k.planOutline(k.insetPlan(gBox, 2.5), 11.3, P, 2), { tone: "faint" });
    let gEmblem = "";
    if (idx === 0) {
      gEmblem = S(k.slabOf(box(20, y0 + 4, 16, 10, 0.5), 11.3, 2.2, P, 2), { tone: "mid" });
    } else if (idx === 1) {
      const F = G.frameAlong([28, y0 + 9, 11.3], [0, 0, 1]);
      gEmblem = S(G.solidOf([[0, 3.8], [3.5, 3.8], [4.4, 2.0]], F, P), { tone: "mid" });
    } else {
      gEmblem = S(k.slabOf(box(20, y0 + 8, 18, 2.4, 0.3), 11.3, 3.2, P, 2), { tone: "mid" });
    }
    const gTxt = k.faceTextSvg(k.topMatrix([18, y0 + 18.5], 11.3, P, "x"), it.id, { size: 3.7, tone: "hi" });

    // 오른쪽 의미 블록 + 상부 그래프 노드 구체(G.sphereOf) 쌍
    const tBox = box(116, y0, 50, 22, 1);
    const tBlock = S(k.slabOf(tBox, 4.8, 6.5, P, 3, 0.5), { tone: "hi", crease: "lo", className: "dx-card" });
    const tIn = L(k.planOutline(k.insetPlan(tBox, 2.5), 11.3, P, 2), { tone: "faint" });
    const n1 = S(G.sphereOf([130, y0 + 8, 13.0], 2.1, P, { steps: 20 }), { tone: "mid" });
    const n2 = S(G.sphereOf([148, y0 + 8, 13.0], 2.1, P, { steps: 20 }), { tone: "mid" });
    const edge = L(k.segment([132, y0 + 8, 13.0], [146, y0 + 8, 13.0], P), { tone: "hi" });
    const tTxt = k.faceTextSvg(k.topMatrix([120, y0 + 18.5], 11.3, P, "x"), "ex:" + it.id, { size: 3.7, tone: "hi" });

    // 좌우 플랜지 소켓 (G.disc) 및 연결 도선
    const FL = G.frameAlong([64, it.y, 8.2], [1, 0, 0]);
    const FR = G.frameAlong([116, it.y, 8.2], [-1, 0, 0]);
    const pinL = S(G.disc(0, 2.4, 2.8, FL, P), { tone: "mid" });
    const pinR = S(G.disc(0, 2.4, 2.8, FR, P), { tone: "mid" });
    const wire = k.wireSvg(at([66.4, it.y, 8.2]), at([113.6, it.y, 8.2]), { tone: "mid", size: 0.85 });

    out.push(`<g class="dx-row" data-i="${idx}">${wire}${gBlock}${gIn}${gEmblem}${gTxt}${pinL}${tBlock}${tIn}${n1}${n2}${edge}${tTxt}${pinR}</g>`);
  });
  return out.join("");
}

function coupler() {
  const out = [];
  const bridge = box(76, -9, 28, 18, 1.2);
  out.push(S(k.slabOf(bridge, 3.2, 10.5, P, 3, 0.6), { tone: "hi", lit: true }));
  // 좌우 선반 가공 잠금 플런저 핀 (G.disc)
  const FL = G.frameAlong([76, 0, 8.2], [-1, 0, 0]);
  const FR = G.frameAlong([104, 0, 8.2], [1, 0, 0]);
  out.push(S(G.disc(0, 9.5, 2.2, FL, P), { tone: "hi", lit: true }));
  out.push(S(G.disc(0, 9.5, 2.2, FR, P), { tone: "hi", lit: true }));
  // 상부 널링 잠금 휠
  out.push(S(k.cylinder(90, 0, 4.6, 13.7, 3.4, P, 24, 0.3), { tone: "mid" }));
  out.push(L(k.knurl(90, 0, 4.6, 13.9, 16.9, 20, P), { tone: "lo" }));
  out.push(k.faceTextSvg(k.topMatrix([81, 6.8], 13.7, P, "x"), "ID KEY", { size: 3.6, tone: "hi" }));
  return out.join("");
}

const FIRST = ITEMS[0];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "왼쪽에 GeoJSON 기하 형상 판, 오른쪽에 Brick TTL 의미 관계 판이 놓여 있고, 가운데 스플라인 축 위의 ID KEY 커플러가 슬라이드하며 같은 ID를 가진 좌우 블록을 하나로 잠그는 모형이다.",
  body: [
    base(),
    platens(),
    `<g data-part="coupler" transform="${k.translateAlong(P, [0, FIRST.y, 0])}">${coupler()}</g>`,
  ],
});

const CSS = `
.iso{--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace}
html{background:#f2f2ef}html:has(body[data-theme="dark"]){background:#0b0b0b}html[data-embed],html[data-embed]:has(body){background:transparent}html:has(body[data-theme="light"]),body[data-theme="light"]{color-scheme:light}body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.iso-page{width:100%;margin:0}.iso-figure{margin:0}.iso-plate{padding:46px 18px 44px}
.dx-stage{outline:none;touch-action:pan-y;cursor:ns-resize}.dx-row{cursor:pointer}
.iso[data-theme="light"]{--anatomy-shade-0:#cfcfcc;--anatomy-shade-1:#d9d9d6;--anatomy-shade-2:#e3e3e0;--anatomy-shade-3:#ececea;--anatomy-mid:#76767c;--anatomy-lo:#a4a4a9;--anatomy-faint:#cdcdd0;--anatomy-muted:#6b6b70;
  --dx-lit-top:#8e8e95;--dx-lit-side:#6e6e75;--dx-lit-edge:#000000}
.iso[data-theme="dark"]{--dx-lit-top:#4a4a4a;--dx-lit-side:#333333;--dx-lit-edge:#ffffff}
.dx-row[data-lit] .dx-card>.iso-top{fill:var(--dx-lit-top)}
.dx-row[data-lit] .dx-card>.iso-shade{fill:var(--dx-lit-side)}
.dx-row[data-lit] .dx-card>.iso-edge{stroke:var(--dx-lit-edge);stroke-width:1.6px}
.dx-steps{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.dx-steps button{font:inherit;font-size:12.5px;line-height:1.3;padding:5px 10px;border:1px solid var(--anatomy-faint);border-radius:6px;background:var(--anatomy-card);color:var(--anatomy-text);cursor:pointer}
.dx-steps button[aria-pressed="true"]{border-color:var(--anatomy-hi);color:var(--anatomy-strong);font-weight:600}
.dx-note{margin:8px 0 0;padding:7px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:12.5px/1.55 system-ui,sans-serif;color:var(--anatomy-strong)}
.dx-grid{display:grid;grid-template-columns:1fr 1fr;gap:6px;margin-top:6px}
.dx-grid pre{margin:0;padding:8px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:11px/1.55 var(--anatomy-mono);color:var(--anatomy-strong);white-space:pre-wrap;overflow-x:auto}
@media (max-width:560px){.dx-grid{grid-template-columns:1fr}}
`;

const DATA = { items: ITEMS.map((it) => ({ ...it, readout: readoutOf(it) })), P };

const LIVE = `
const D = ${JSON.stringify(DATA)};
const P = D.P;
const stage = document.querySelector(".dx-stage");
const coupler = stage.querySelector('[data-part="coupler"]');
const rows = [...stage.querySelectorAll(".dx-row")];
const buttons = [...document.querySelectorAll(".dx-steps button")];
const readout = document.querySelector("[data-readout]");
const note = document.querySelector("[data-note]");
const geo = document.querySelector("[data-geo]");
const ttl = document.querySelector("[data-ttl]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let pick = 0, cy = D.items[pick].y, ty = cy;
let frame = 0, last = 0, clock = 0, visible = false, touring = !still.matches, tourAt = 0, idle = 0, dragging = null;

function draw() {
  coupler.setAttribute("transform", translateAlong(P, [0, cy, 0]));
  rows.forEach((r, i) => r.toggleAttribute("data-lit", i === pick));
}
function select(n) {
  pick = n;
  const it = D.items[n];
  ty = it.y;
  readout.textContent = it.readout;
  note.textContent = it.note;
  geo.textContent = "// floor-Level_2.geojson\\n" + it.geo;
  ttl.textContent = "# ontology.ttl\\n" + it.ttl;
  buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === n)));
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring && clock - tourAt > 4.0) { tourAt = clock; select((pick + 1) % D.items.length); }
  cy = still.matches ? ty : (Math.abs(ty - cy) < 0.08 ? ty : cy + (ty - cy) * (1 - Math.exp(-dt / 0.2)));
  draw();
  frame = visible && (touring || cy !== ty) ? requestAnimationFrame(tick) : 0;
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
  const r = e.target.closest(".dx-row");
  if (r) { steer(Number(r.dataset.i)); return; }
  dragging = { y0: e.clientY, cy0: ty, moved: false };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dy = e.clientY - dragging.y0;
  if (Math.abs(dy) > 4) dragging.moved = true;
  ty = Math.max(24, Math.min(88, dragging.cy0 + dy * 0.45));
  let best = 0, bestDist = 999;
  D.items.forEach((it, idx) => { const d = Math.abs(it.y - ty); if (d < bestDist) { bestDist = d; best = idx; } });
  if (best !== pick) {
    pick = best;
    const it = D.items[best];
    readout.textContent = it.readout;
    note.textContent = it.note;
    geo.textContent = "// floor-Level_2.geojson\\n" + it.geo;
    ttl.textContent = "# ontology.ttl\\n" + it.ttl;
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === best)));
  }
  run();
});
stage.addEventListener("pointerup", () => {
  if (dragging && !dragging.moved) steer((pick + 1) % D.items.length);
  else if (dragging) select(pick);
  dragging = null;
});
buttons.forEach((b, n) => b.addEventListener("click", () => steer(n)));
stage.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); steer((pick + 1) % D.items.length); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); steer((pick + D.items.length - 1) % D.items.length); }
});
select(pick);
draw();
if (parent !== window) document.documentElement.setAttribute("data-embed", "");
const size = () => parent !== window && parent.postMessage({ type: "guide-fig-size", fig: "dual-export", height: document.documentElement.scrollHeight }, "*");
addEventListener("load", size);
new ResizeObserver(size).observe(document.body);
`;

const KEYS = [
  { mark: "lit", label: "선택한 객체의 GeoJSON Feature 와 Brick TTL 블록" },
  { mark: "raised", label: "두 파일을 1:1로 잠그는 스플라인 공유 ID KEY 커플러" },
];
const CAPTION =
  "온톨로지(TTL)에는 좌표를 넣지 않고 의미·계층·흐름 관계만 적으며, 2D/3D 기하 좌표는 층별 GeoJSON에 적습니다. 두 파일은 모든 공간·설비 객체가 같은 ID 문자열을 공유함으로써 DT 플랫폼에서 하나의 디지털 트윈 모델로 결합됩니다.";

function page(theme) {
  const plate = k.plateHtml({
    fig: "Fig 6",
    title: "TTL(의미)과 GeoJSON(형상)은 어떻게 ID 하나로 이어지나",
    hint: "객체 블록을 누르거나 중앙 커플러를 드래그해 비교하기",
    readout: readoutOf(FIRST),
    keys: KEYS,
    caption: CAPTION,
    body: `<div class="iso-stage dx-stage" tabindex="0" role="group" aria-label="TTL·GeoJSON ID 커플러 모형">${svg}</div>`,
  });
  const btns = `<div class="dx-steps" role="group" aria-label="비교 객체">${ITEMS.map((it) => `<button type="button" aria-pressed="${it === FIRST}">${it.name}</button>`).join("")}</div>`;
  const extra = `${btns}<p class="dx-note" data-note>${FIRST.note}</p><div class="dx-grid"><pre data-geo></pre><pre data-ttl></pre></div>`;
  const html = `<style>${CSS}</style>` + plate.replace('<figcaption class="iso-legend">', `${extra}<figcaption class="iso-legend">`);
  return k.pageHtml({ title: "TTL과 GeoJSON은 어떻게 ID 하나로 이어지나", theme, body: html, script: kitScript() + LIVE, width: 760 }).replace('<html lang="en">', '<html lang="ko">');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "dual-export.html"), page("light"));
writeFileSync(join(OUT, "dual-export-dark.html"), page("dark"));
console.log("wrote dual-export.html, dual-export-dark.html");
