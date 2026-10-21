// 가이드 그림 8: 내보낸 TTL과 층별 GeoJSON 5종 정합성 검수 게이트(viewer.html)를 상부 브리지 5핀 낙하 검수대로 보이는 모형이다.
// 다시 만들려면 `node scripts/guide/figures/validator/build.mjs` 를 돌린다.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import { springZ } from "../spring.mjs";
import * as G from "../../anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../anatomy/kit/tube.mjs";
import { kitScript } from "../../anatomy/scripts/inline-kit.mjs";
import { CHECKS as GATES, readoutOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "..", "public", "guide", "fig");

const WIDTH = 600;
const HEIGHT = 395;
const BASE = { x: -14, y: -14, w: 208, d: 146, r: 6 };
const BASE_H = 8;
const FOOT_H = 5;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [0, 0, 68],
    [186, 122, 68],
  ],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: 46, elevation: 35 },
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
  for (const [x, y] of k.corners(BASE, 9)) {
    out.push(L(k.ring(x, y, 2, 0, P, 14), { tone: "lo" }));
    out.push(D([at([x, y, 0])], { size: 0.48 }));
  }
  const ruler = box(12, 110, 156, 5, 1);
  out.push(S(k.slabOf(ruler, 0, 0.7, P, 2), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(16, 164, 4, 5, 110, 0.7, [1.6, 3.2], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

function dualDecksAndGantry() {
  const out = [];
  const ttlDeck = box(14, 8, 152, 22, 1.2);
  out.push(S(k.slabOf(ttlDeck, 0, 5.8, P, 3, 0.5), { tone: "mid", crease: "lo", inner: L(k.sideSeam(ttlDeck, 2.8, P, 3), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(ttlDeck, 2), 5.8, P, 2), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([22, 24], 5.8, P, "x"), "ONTOLOGY.TTL · GRAPH TRIPLES", { size: 3.9, tone: "hi" }));

  const geoDeck = box(14, 80, 152, 22, 1.2);
  out.push(S(k.slabOf(geoDeck, 0, 5.8, P, 3, 0.5), { tone: "mid", crease: "lo", inner: L(k.sideSeam(geoDeck, 2.8, P, 3), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(geoDeck, 2), 5.8, P, 2), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([22, 96], 5.8, P, "x"), "FLOOR-*.GEOJSON · 2D POLYGONS", { size: 3.9, tone: "hi" }));

  GATES.forEach((g, idx) => {
    const p = box(g.x - 12, 37, 24, 36, 1.2);
    const h = 9.6;
    const mod = S(k.slabOf(p, 0, h, P, 3, 0.5), { tone: "hi", crease: "lo", className: "vl-mod" });
    const inner = L(k.planOutline(k.insetPlan(p, 2), h, P, 2), { tone: "faint" });
    // 선반 가공 검수 소켓 부싱 (G.solidOf)
    const sockF = G.frameAlong([g.x, 52, h], [0, 0, 1]);
    const sock = S(G.solidOf([[0, 4.8], [1.6, 4.8], [2.0, 3.2]], sockF, P), { tone: "mid" }) + L(k.ring(g.x, 52, 2.2, h + 2.0, P, 16), { tone: "lo" });

    // 양방향 검수 도선 (tubePieces)
    const backTube = tubePieces([[g.x, 37, 6.2], [g.x, 30, 5.8]], 1.2, P, { maxLength: 8 }).map((pc) => tubeSvg(pc, { tone: "mid" })).join("");
    const frontTube = tubePieces([[g.x, 73, 6.2], [g.x, 80, 5.8]], 1.2, P, { maxLength: 8 }).map((pc) => tubeSvg(pc, { tone: "mid" })).join("");

    const txt = k.faceTextSvg(k.topMatrix([p.x + 4, p.y + 30], h, P, "x"), `G${idx + 1}`, { size: 4.8, tone: "hi" });
    out.push(`<g class="vl-gate" data-i="${idx}">${backTube}${frontTube}${mod}${inner}${sock}${txt}</g>`);
  });

  // 상부 아치 브리지 기둥 + 코일 스프링 + 5개 가이드 슬리브
  for (const px of [8, 172]) {
    out.push(S(k.cylinder(px, 52, 4.5, 0, 2.2, P, 20), { tone: "lo" }));
    out.push(S(k.cylinder(px, 52, 2.8, 2.2, 42, P, 20), { tone: "mid", crease: "none" }));
  }
  const beam = box(4, 46, 172, 12, 1);
  out.push(S(k.slabOf(beam, 44, 4.8, P, 3, 0.5), { tone: "mid", crease: "lo" }));
  out.push(k.faceTextSvg(k.topMatrix([18, 54.5], 48.8, P, "x"), "VIEWER.HTML · 5-GATE PIN-TUMBLER TESTER", { size: 3.8, tone: "hi" }));

  GATES.forEach((g) => {
    out.push(S(k.cylinder(g.x, 52, 3.4, 42, 7.5, P, 18), { tone: "mid" }));
    out.push(L(k.knurl(g.x, 52, 3.4, 48.8, 50.2, 16, P), { tone: "lo" }));
  });
  return out.join("");
}

function plungerHead() {
  const out = [];
  const head = box(-10, 44, 20, 16, 1.2);
  // 상부 코일 복원 스프링 (k.coil)
  const spring = springZ(0, 52, 3.6, 33.5, 43.5, 4, P);
  out.push(L(spring.back, { tone: "mid" }), L(spring.front, { tone: "hi" }));
  out.push(S(k.slabOf(head, 24, 9.2, P, 3, 0.5), { tone: "hi", lit: true }));
  // 선반 가공 마이크로미터 검수 플런저 침 (G.solidOf)
  const F = G.frameAlong([0, 52, 11.2], [0, 0, 1]);
  const prof = [[0, 1.4], [1.8, 4.2], [3.6, 4.2], [4.0, 2.4], [12.8, 2.4]];
  out.push(S(G.solidOf(prof, F, P), { tone: "hi", lit: true }));
  return out.join("");
}

const FIRST = GATES[0];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "뒤쪽 TTL 입력 덱과 앞쪽 GeoJSON 입력 덱 사이에 5개의 정합성 검수 소켓(G1~G5)이 놓여 있고, 상부 아치 브리지에서 코일 스프링이 달린 수직 마이크로미터 플런저 헤드가 각 소켓으로 내려오며 정합성을 판정하는 모형이다.",
  body: [
    base(),
    dualDecksAndGantry(),
    `<g data-part="car" transform="${k.translateAlong(P, [FIRST.x, 0, 0])}">${plungerHead()}</g>`,
  ],
});

const CSS = `
.iso{--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace}
html{background:#f2f2ef}html:has(body[data-theme="dark"]){background:#0b0b0b}html[data-embed]{background:transparent}html:has(body[data-theme="light"]),body[data-theme="light"]{color-scheme:light}body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.iso-page{width:100%;margin:0}.iso-figure{margin:0}.iso-plate{padding:46px 18px 44px}
.vl-stage{outline:none;touch-action:pan-y;cursor:ew-resize}.vl-gate{cursor:pointer}
.iso[data-theme="light"]{--anatomy-shade-0:#cfcfcc;--anatomy-shade-1:#d9d9d6;--anatomy-shade-2:#e3e3e0;--anatomy-shade-3:#ececea;--anatomy-mid:#76767c;--anatomy-lo:#a4a4a9;--anatomy-faint:#cdcdd0;--anatomy-muted:#6b6b70;
  --vl-lit-top:#8e8e95;--vl-lit-side:#6e6e75;--vl-lit-edge:#000000}
.iso[data-theme="dark"]{--vl-lit-top:#4a4a4a;--vl-lit-side:#333333;--vl-lit-edge:#ffffff}
.vl-gate[data-lit] .vl-mod>.iso-top{fill:var(--vl-lit-top)}
.vl-gate[data-lit] .vl-mod>.iso-shade{fill:var(--vl-lit-side)}
.vl-gate[data-lit] .vl-mod>.iso-edge{stroke:var(--vl-lit-edge);stroke-width:1.6px}
.vl-steps{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.vl-steps button{font:inherit;font-size:12.5px;line-height:1.3;padding:5px 10px;border:1px solid var(--anatomy-faint);border-radius:6px;background:var(--anatomy-card);color:var(--anatomy-text);cursor:pointer}
.vl-steps button[aria-pressed="true"]{border-color:var(--anatomy-hi);color:var(--anatomy-strong);font-weight:600}
.vl-note{margin:8px 0 0;padding:7px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:12.5px/1.55 system-ui,sans-serif;color:var(--anatomy-strong)}
.vl-ttl{margin:6px 0 0;padding:8px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:11.5px/1.6 var(--anatomy-mono);color:var(--anatomy-strong);white-space:pre-wrap}
`;

const DATA = { gates: GATES.map((g) => ({ ...g, readout: readoutOf(g) })), P };

const LIVE = `
const D = ${JSON.stringify(DATA)};
const P = D.P;
const stage = document.querySelector(".vl-stage");
const car = stage.querySelector('[data-part="car"]');
const gates = [...stage.querySelectorAll(".vl-gate")];
const buttons = [...document.querySelectorAll(".vl-steps button")];
const readout = document.querySelector("[data-readout]");
const note = document.querySelector("[data-note]");
const ttl = document.querySelector("[data-ttl]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let pick = 0, cx = D.gates[pick].x, tx = cx, cz = 0;
let frame = 0, last = 0, clock = 0, visible = false, touring = !still.matches, tourAt = 0, idle = 0, dragging = null;

function draw() {
  car.setAttribute("transform", translateAlong(P, [cx, 0, cz]));
  gates.forEach((g, i) => g.toggleAttribute("data-lit", i === pick));
}
function select(n) {
  pick = n;
  cz = 6;
  const g = D.gates[n];
  tx = g.x;
  readout.textContent = g.readout;
  note.textContent = g.note;
  ttl.textContent = g.detail + "\\n# 검증 규칙: " + g.rule + " (PASS)";
  buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === n)));
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring && clock - tourAt > 3.8) { tourAt = clock; select((pick + 1) % D.gates.length); }
  cx = still.matches ? tx : (Math.abs(tx - cx) < 0.08 ? tx : cx + (tx - cx) * (1 - Math.exp(-dt / 0.2)));
  cz = still.matches ? 0 : (Math.abs(cz) < 0.05 ? 0 : cz * Math.exp(-dt / 0.16));
  draw();
  frame = visible && (touring || cx !== tx || cz !== 0) ? requestAnimationFrame(tick) : 0;
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
  const g = e.target.closest(".vl-gate");
  if (g) { steer(Number(g.dataset.i)); return; }
  dragging = { x0: e.clientX, cx0: tx, moved: false };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragging.x0;
  if (Math.abs(dx) > 4) dragging.moved = true;
  tx = Math.max(24, Math.min(156, dragging.cx0 + dx * 0.42));
  let best = 0, bestDist = 999;
  D.gates.forEach((g, idx) => { const d = Math.abs(g.x - tx); if (d < bestDist) { bestDist = d; best = idx; } });
  if (best !== pick) {
    pick = best;
    cz = 4;
    const g = D.gates[best];
    readout.textContent = g.readout;
    note.textContent = g.note;
    ttl.textContent = g.detail + "\\n# 검증 규칙: " + g.rule + " (PASS)";
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === best)));
  }
  run();
});
stage.addEventListener("pointerup", () => {
  if (dragging && !dragging.moved) steer((pick + 1) % D.gates.length);
  else if (dragging) select(pick);
  dragging = null;
});
buttons.forEach((b, n) => b.addEventListener("click", () => steer(n)));
stage.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); steer((pick + 1) % D.gates.length); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); steer((pick + D.gates.length - 1) % D.gates.length); }
});
select(pick);
draw();
if (parent !== window) document.documentElement.setAttribute("data-embed", "");
const size = () => parent !== window && parent.postMessage({ type: "guide-fig-size", fig: "validator", height: document.documentElement.scrollHeight }, "*");
addEventListener("load", size);
new ResizeObserver(size).observe(document.body);
`;

const KEYS = [
  { mark: "lit", label: "현재 플런저가 내려앉아 정합성을 검증 중인 소켓(G1~G5)" },
  { mark: "raised", label: "TTL 입력 덱 · GeoJSON 입력 덱과 상부 아치 브리지" },
];
const CAPTION =
  "내보낸 파일 보기(viewer.html)는 DT 플랫폼 파서와 같은 규칙으로 TTL과 층별 GeoJSON을 함께 읽어 다섯 가지 정합성 게이트를 검사합니다. 다섯 항목이 모두 통과(0건)해야 플랫폼 적재 시 공간 누락이나 끊어진 참조가 발생하지 않습니다.";

function page(theme) {
  const plate = k.plateHtml({
    fig: "Fig 8",
    title: "내보낸 TTL·GeoJSON 5종 정합성 검사는 무엇을 보나",
    hint: "게이트(G1~G5)를 누르거나 검수 헤드를 좌우로 드래그",
    readout: readoutOf(FIRST),
    keys: KEYS,
    caption: CAPTION,
    body: `<div class="iso-stage vl-stage" tabindex="0" role="group" aria-label="TTL GeoJSON 5종 정합성 검수 모형">${svg}</div>`,
  });
  const btns = `<div class="vl-steps" role="group" aria-label="검수 게이트">${GATES.map((g, i) => `<button type="button" aria-pressed="${g === FIRST}">${g.name}</button>`).join("")}</div>`;
  const extra = `${btns}<p class="vl-note" data-note>${FIRST.note}</p><pre class="vl-ttl" data-ttl>${FIRST.detail}</pre>`;
  const html = `<style>${CSS}</style>` + plate.replace('<figcaption class="iso-legend">', `${extra}<figcaption class="iso-legend">`);
  return k.pageHtml({ title: "내보낸 TTL·GeoJSON 5종 정합성 검사는 무엇을 보나", theme, body: html, script: kitScript() + LIVE, width: 760 }).replace('<html lang="en">', '<html lang="ko">');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "validator.html"), page("light"));
writeFileSync(join(OUT, "validator-dark.html"), page("dark"));
console.log("wrote validator.html, validator-dark.html");
