// 가이드 그림 4: 설비 속성 값의 4가지 출처(BIM · 사전 · 계산 · 사람)와 우선순위 선택기를 보이는 4채널 계전기 모형이다.
// 다시 만들려면 `node scripts/guide/figures/provenance/build.mjs` 를 돌린다.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import * as G from "../../anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../anatomy/kit/tube.mjs";
import { kitScript } from "../../anatomy/scripts/inline-kit.mjs";
import { CHANNELS, readoutOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "..", "public", "guide", "fig");

const WIDTH = 600;
const HEIGHT = 385;
const BASE = { x: -8, y: -12, w: 202, d: 140, r: 6 };
const BASE_H = 8;
const FOOT_H = 5;
const RAIL_Y = 76;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [0, 0, 56],
    [188, 122, 56],
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
  const ruler = box(10, 108, 164, 5, 1);
  out.push(S(k.slabOf(ruler, 0, 0.7, P, 2), { tone: "lo", crease: "none" }));
  const ticks = k.topTicks(14, 170, 4, 5, 108, 0.7, [1.6, 3.2], P);
  out.push(L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

function channels() {
  const out = [];
  // 뒤쪽 온톨로지 출력 버스 바 + 4개 선반 가공 단자 부싱
  const bus = box(12, 6, 160, 16, 1.2);
  out.push(S(k.slabOf(bus, 0, 11, P, 3, 0.6), { tone: "mid", crease: "lo", inner: L(k.sideSeam(bus, 5, P, 3), { tone: "faint" }) }));
  out.push(L(k.planOutline(k.insetPlan(bus, 2), 11, P, 2), { tone: "faint" }));
  out.push(k.faceTextSvg(k.topMatrix([20, 17.5], 11, P, "x"), "ONTOLOGY ATTRIBUTE BUS · 사람 > BIM > 계산·사전", { size: 3.9, tone: "hi" }));

  // 4개 출처 계전기 블록 + 선반 가공 솔레노이드 터렛(G.solidOf) + 코일 스프링 + 3D 편조 케이블(tubePieces)
  CHANNELS.forEach((ch, idx) => {
    const p = box(ch.x - 16, 32, 32, 34, 1.2);
    const h = 8.5 + idx * 2.5;
    const mod = S(k.slabOf(p, 0, h, P, 3, 0.5), { tone: "hi", crease: "lo", className: "pv-mod" });
    const inner = L(k.planOutline(k.insetPlan(p, 2.2), h, P, 2), { tone: "faint" });

    // 상부 선반 가공 솔레노이드 플런저 & 코일 스프링
    const F = G.frameAlong([ch.x, 42, h], [0, 0, 1]);
    const prof = [[0, 6.2], [1.4, 6.2], [1.8, 3.8], [5.8, 3.8], [6.8, 4.8]];
    const turret = S(G.solidOf(prof, F, P), { tone: "mid" }) + L(k.coil(ch.x, 42, 4.4, h + 1.5, h + 5.6, 3, P), { tone: "lo" });

    // 버스 연결 3D 케이블 (tubePieces)
    const cablePts = G.fillet([[ch.x, 32, h - 2], [ch.x, 26, h + 3], [ch.x, 22, 8.5]], 2.5, 6, { P, tube: 1.3 });
    const cable = tubePieces(cablePts, 1.3, P, { maxLength: 8 }).map((pc) => tubeSvg(pc, { tone: "mid" })).join("");

    const txt = k.faceTextSvg(k.topMatrix([p.x + 5, p.y + 28], h, P, "x"), ch.badge, { size: 5.0, tone: "hi" });
    out.push(`<g class="pv-ch" data-i="${idx}">${cable}${mod}${inner}${turret}${txt}</g>`);
  });

  // 앞쪽 선택기 주행 레일 및 좌우 리드스크류 지지대
  out.push(S(k.slabOf(box(10, RAIL_Y, 164, 6.5, 0.8), 0, 3.5, P, 2, 0.4), { tone: "mid" }));
  return out.join("");
}

function carriage() {
  const out = [];
  const p = box(-13, RAIL_Y - 3.5, 26, 13.5, 1.2);
  out.push(S(k.slabOf(p, 3.5, 8.5, P, 3, 0.5), { tone: "hi", lit: true }));
  // 앞쪽으로 뻗은 판독 와이퍼 침
  out.push(S(k.slabOf(box(-2.8, 63, 5.6, 10, 0.4), 6.0, 4.2, P, 2), { tone: "hi", lit: true }));
  // 상부 널링 선택 노브
  out.push(S(k.cylinder(0, RAIL_Y + 3, 4.5, 12.0, 3.4, P, 24, 0.3), { tone: "mid" }));
  out.push(L(k.knurl(0, RAIL_Y + 3, 4.5, 12.2, 15.2, 20, P), { tone: "lo" }));
  return out.join("");
}

const FIRST = CHANNELS[1];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "받침판 위에 BIM, 사전, 계산, 사람 네 개의 출처 계전기 블록이 나란히 놓여 있고, 앞쪽 레일의 판독 캐리지가 각 출처 블록을 가리키며 뒤쪽 온톨로지 속성 버스로 값을 전달하는 모형이다.",
  body: [
    base(),
    channels(),
    `<g data-part="car" transform="${k.translateAlong(P, [FIRST.x, 0, 0])}">${carriage()}</g>`,
  ],
});

const CSS = `
.iso{--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace}
html{background:#f2f2ef}html:has(body[data-theme="dark"]){background:#0b0b0b}html[data-embed]{background:transparent}html:has(body[data-theme="light"]),body[data-theme="light"]{color-scheme:light}body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.iso-page{width:100%;margin:0}.iso-figure{margin:0}.iso-plate{padding:46px 18px 44px}
.pv-stage{outline:none;touch-action:pan-y;cursor:ew-resize}.pv-ch{cursor:pointer}
.iso[data-theme="light"]{--anatomy-shade-0:#cfcfcc;--anatomy-shade-1:#d9d9d6;--anatomy-shade-2:#e3e3e0;--anatomy-shade-3:#ececea;--anatomy-mid:#76767c;--anatomy-lo:#a4a4a9;--anatomy-faint:#cdcdd0;--anatomy-muted:#6b6b70;
  --pv-lit-top:#8e8e95;--pv-lit-side:#6e6e75;--pv-lit-edge:#000000}
.iso[data-theme="dark"]{--pv-lit-top:#4a4a4a;--pv-lit-side:#333333;--pv-lit-edge:#ffffff}
.pv-ch[data-lit] .pv-mod>.iso-top{fill:var(--pv-lit-top)}
.pv-ch[data-lit] .pv-mod>.iso-shade{fill:var(--pv-lit-side)}
.pv-ch[data-lit] .pv-mod>.iso-edge{stroke:var(--pv-lit-edge);stroke-width:1.6px}
.pv-steps{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.pv-steps button{font:inherit;font-size:12.5px;line-height:1.3;padding:5px 10px;border:1px solid var(--anatomy-faint);border-radius:6px;background:var(--anatomy-card);color:var(--anatomy-text);cursor:pointer}
.pv-steps button[aria-pressed="true"]{border-color:var(--anatomy-hi);color:var(--anatomy-strong);font-weight:600}
.pv-note{margin:8px 0 0;padding:7px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:12.5px/1.55 system-ui,sans-serif;color:var(--anatomy-strong)}
.pv-ttl{margin:6px 0 0;padding:8px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:11.5px/1.6 var(--anatomy-mono);color:var(--anatomy-strong);white-space:pre-wrap}
`;

const DATA = { channels: CHANNELS.map((c) => ({ ...c, readout: readoutOf(c) })), P };

const LIVE = `
const D = ${JSON.stringify(DATA)};
const P = D.P;
const stage = document.querySelector(".pv-stage");
const car = stage.querySelector('[data-part="car"]');
const chs = [...stage.querySelectorAll(".pv-ch")];
const buttons = [...document.querySelectorAll(".pv-steps button")];
const readout = document.querySelector("[data-readout]");
const note = document.querySelector("[data-note]");
const ttl = document.querySelector("[data-ttl]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let pick = 1, cx = D.channels[pick].x, tx = cx;
let frame = 0, last = 0, clock = 0, visible = false, touring = !still.matches, tourAt = 0, idle = 0, dragging = null;

function draw() {
  car.setAttribute("transform", translateAlong(P, [cx, 0, 0]));
  chs.forEach((g, i) => g.toggleAttribute("data-lit", i === pick));
}
function select(n) {
  pick = n;
  const c = D.channels[n];
  tx = c.x;
  readout.textContent = c.readout;
  note.textContent = c.note;
  ttl.textContent = c.ttl;
  buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === n)));
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring && clock - tourAt > 3.6) { tourAt = clock; select((pick + 1) % D.channels.length); }
  cx = still.matches ? tx : (Math.abs(tx - cx) < 0.08 ? tx : cx + (tx - cx) * (1 - Math.exp(-dt / 0.2)));
  draw();
  frame = visible && (touring || cx !== tx) ? requestAnimationFrame(tick) : 0;
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
  const g = e.target.closest(".pv-ch");
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
  D.channels.forEach((c, idx) => { const d = Math.abs(c.x - tx); if (d < bestDist) { bestDist = d; best = idx; } });
  if (best !== pick) {
    pick = best;
    const c = D.channels[best];
    readout.textContent = c.readout;
    note.textContent = c.note;
    ttl.textContent = c.ttl;
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === best)));
  }
  run();
});
stage.addEventListener("pointerup", () => {
  if (dragging && !dragging.moved) steer((pick + 1) % D.channels.length);
  else if (dragging) select(pick);
  dragging = null;
});
buttons.forEach((b, n) => b.addEventListener("click", () => steer(n)));
stage.addEventListener("keydown", (e) => {
  if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); steer((pick + 1) % D.channels.length); }
  else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); steer((pick + D.channels.length - 1) % D.channels.length); }
});
select(pick);
draw();
if (parent !== window) document.documentElement.setAttribute("data-embed", "");
const size = () => parent !== window && parent.postMessage({ type: "guide-fig-size", fig: "provenance", height: document.documentElement.scrollHeight }, "*");
addEventListener("load", size);
new ResizeObserver(size).observe(document.body);
`;

const KEYS = [
  { mark: "lit", label: "현재 채택된 속성 출처 계전기 블록" },
  { mark: "raised", label: "판독 캐리지와 후면 온톨로지 속성 버스" },
];
const CAPTION =
  "에디터의 모든 속성 옆에는 출처 배지(BIM · 사전 · 계산 · 사람)가 붙습니다. 원본 BIM에 없는 값을 사전(이름 규칙)과 계산(좌표·형상)이 먼저 채우고, 사람이 고치면 언제나 '사람' 값이 최우선으로 적용됩니다.";

function page(theme) {
  const plate = k.plateHtml({
    fig: "Fig 4",
    title: "값의 출처(BIM · 사전 · 계산 · 사람)는 어떻게 정해지나",
    hint: "출처 블록을 누르거나 캐리지를 좌우로 드래그",
    readout: readoutOf(FIRST),
    keys: KEYS,
    caption: CAPTION,
    body: `<div class="iso-stage pv-stage" tabindex="0" role="group" aria-label="속성 출처 4채널 계전기 모형">${svg}</div>`,
  });
  const btns = `<div class="pv-steps" role="group" aria-label="출처 채널">${CHANNELS.map((c) => `<button type="button" aria-pressed="${c === FIRST}">${c.name}</button>`).join("")}</div>`;
  const extra = `${btns}<p class="pv-note" data-note>${FIRST.note}</p><pre class="pv-ttl" data-ttl>${FIRST.ttl}</pre>`;
  const html = `<style>${CSS}</style>` + plate.replace('<figcaption class="iso-legend">', `${extra}<figcaption class="iso-legend">`);
  return k.pageHtml({ title: "값의 출처는 어떻게 정해지나", theme, body: html, script: kitScript() + LIVE, width: 760 }).replace('<html lang="en">', '<html lang="ko">');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "provenance.html"), page("light"));
writeFileSync(join(OUT, "provenance-dark.html"), page("dark"));
console.log("wrote provenance.html, provenance-dark.html");
