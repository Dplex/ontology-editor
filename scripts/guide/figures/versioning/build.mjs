// 가이드 그림 9: 자동 저장(로컬) → 임시 저장(서버 층 슬롯) → 구축하기(v1) → 반영하기(v2)로 이어지는 버전 이송·스태커 모형이다.
// 다시 만들려면 `node scripts/guide/figures/versioning/build.mjs` 를 돌린다.
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as k from "../../anatomy/kit/iso-kit.mjs";
import { springZ } from "../spring.mjs";
import * as G from "../../anatomy/kit/lathe.mjs";
import { tubePieces, tubeSvg } from "../../anatomy/kit/tube.mjs";
import { kitScript } from "../../anatomy/scripts/inline-kit.mjs";
import { STAGES, readoutOf } from "./model.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const OUT = join(HERE, "..", "..", "..", "..", "public", "guide", "fig");

const WIDTH = 600;
const HEIGHT = 390;
const BASE = { x: -10, y: -12, w: 206, d: 142, r: 6 };
const BASE_H = 8;
const FOOT_H = 5;

const P = k.fitProjection(
  [
    ...k.boxCorners(BASE, -BASE_H - FOOT_H, 0),
    [0, 0, 58],
    [190, 122, 58],
  ],
  WIDTH,
  HEIGHT,
  { pad: 14, azimuth: 52, elevation: 34 },
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
  return out.join("");
}

function stations() {
  const out = [];
  // 스테이션 간 3D 이송 파이프라인 (tubePieces)
  const pipePts = [[22, 14, 4.5], [156, 14, 4.5]];
  for (const pc of tubePieces(pipePts, 1.8, P, { maxLength: 18 })) {
    out.push(tubeSvg(pc, { tone: "mid" }));
  }

  // 1. 로컬 브라우저 트레이 + 디스크 플래터 (G.disc)
  const s1 = box(6, 22, 32, 44, 1.2);
  const s1Disc = S(k.cylinder(22, 38, 9.5, 6, 1.8, P, 28), { tone: "mid" }) + L(k.ring(22, 38, 3.2, 7.8, P, 16), { tone: "lo" });
  out.push(`<g class="vs-st" data-i="0">${S(k.slabOf(s1, 0, 6, P, 3, 0.5), { tone: "hi", crease: "lo", className: "vs-card" })}${s1Disc}${k.faceTextSvg(k.topMatrix([10, 58], 6, P, "x"), "LOCAL", { size: 4.2, tone: "hi" })}</g>`);

  // 2. 서버 층별 임시 저장 랙 (1F, 2F 슬롯 + 잠금 핀)
  const s2 = box(50, 20, 36, 48, 1.2);
  const s2Base = S(k.slabOf(s2, 0, 9, P, 3, 0.5), { tone: "hi", crease: "lo", className: "vs-card" });
  const slot1 = S(k.slabOf(box(54, 24, 28, 16, 0.6), 9, 2.8, P, 2), { tone: "mid" });
  const slot2 = S(k.slabOf(box(54, 44, 28, 16, 0.6), 9, 2.8, P, 2), { tone: "mid" });
  const lockPin = S(k.cylinder(68, 32, 2.2, 11.8, 3.2, P, 16), { tone: "hi" });
  out.push(`<g class="vs-st" data-i="1">${s2Base}${slot1}${slot2}${lockPin}${k.faceTextSvg(k.topMatrix([54, 63], 9, P, "x"), "DRAFTS", { size: 4.2, tone: "hi" })}</g>`);

  // 3 & 4. 서버 정식 배포 볼트 스태커 (BUILD v1, PUB v2) + 상부 스탬프 프레스 아치
  const vault = box(100, 16, 72, 54, 1.5);
  out.push(S(k.slabOf(vault, 0, 5, P, 4, 0.6), { tone: "mid" }));
  // 스탬프 프레스 기둥 + 코일 스프링
  for (const px of [104, 168]) {
    const spring = springZ(px, 18, 3.2, 26, 36, 4, P);
    out.push(L(spring.back, { tone: "faint" }));
    out.push(S(k.cylinder(px, 18, 2.4, 5, 34, P, 18), { tone: "mid", crease: "none" }));
    out.push(L(spring.front, { tone: "lo" }));
  }
  out.push(S(k.slabOf(box(100, 14, 72, 8, 1), 39, 3.8, P, 2), { tone: "mid" }));
  out.push(k.faceTextSvg(k.topMatrix([108, 20], 42.8, P, "x"), "DT RELEASE VAULT", { size: 3.7, tone: "hi" }));

  const v1Box = box(106, 24, 28, 40, 1);
  out.push(`<g class="vs-st" data-i="2" data-part="v1">${S(k.slabOf(v1Box, 5, 9, P, 3, 0.5), { tone: "hi", crease: "lo", className: "vs-card" })}${k.faceTextSvg(k.topMatrix([110, 56], 14, P, "x"), "BUILD v1", { size: 4, tone: "hi" })}</g>`);

  const v2Box = box(138, 24, 28, 40, 1);
  out.push(`<g class="vs-st" data-i="3" data-part="v2">${S(k.slabOf(v2Box, 5, 13.5, P, 3, 0.5), { tone: "hi", crease: "lo", className: "vs-card" })}${k.faceTextSvg(k.topMatrix([142, 56], 18.5, P, "x"), "PUB v2", { size: 4, tone: "hi" })}</g>`);

  // 앞쪽 이송 레일 & 눈금자
  out.push(S(k.slabOf(box(10, 82, 160, 6.5, 0.8), 0, 3.5, P, 2, 0.4), { tone: "mid" }));
  const ticks = k.topTicks(14, 166, 5, 4, 93, 0.7, [1.5, 3], P);
  out.push(S(k.slabOf(box(10, 93, 160, 5, 0.8), 0, 0.7, P, 2), { tone: "lo", crease: "none" }), L(ticks.minor, { tone: "lo" }), L(ticks.major, { tone: "mid" }));
  return out.join("");
}

function shuttle() {
  const out = [];
  out.push(S(k.slabOf(box(-12, 79, 24, 13, 1), 3.5, 8.0, P, 3, 0.5), { tone: "hi", lit: true }));
  out.push(S(k.slabOf(box(-2.8, 69, 5.6, 10, 0.4), 5.8, 4.2, P, 2), { tone: "hi", lit: true }));
  out.push(S(k.cylinder(0, 85.5, 4.2, 11.5, 3.0, P, 22, 0.3), { tone: "mid" }));
  out.push(L(k.knurl(0, 85.5, 4.2, 11.7, 14.3, 18, P), { tone: "lo" }));
  return out.join("");
}

const FIRST = STAGES[2];
const svg = k.figureSvg({
  width: WIDTH,
  height: HEIGHT,
  label: "왼쪽부터 로컬 자동 저장 트레이, 서버 층별 임시 저장 랙, 서버 정식 반영본 볼트 스태커(BUILD v1, PUB v2)가 차례로 놓여 있고, 앞쪽 레일의 이송 셔틀이 현재 저장 단계를 가리키는 모형이다.",
  body: [
    base(),
    stations(),
    `<g data-part="shuttle" transform="${k.translateAlong(P, [FIRST.carX, 0, 0])}">${shuttle()}</g>`,
  ],
});

const CSS = `
.iso{--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,"Noto Sans Mono CJK KR","Noto Sans CJK KR",monospace}
html{background:#f2f2ef}html:has(body[data-theme="dark"]){background:#0b0b0b}html[data-embed],html[data-embed]:has(body){background:transparent}html:has(body[data-theme="light"]),body[data-theme="light"]{color-scheme:light}body{background:transparent;font-family:system-ui,-apple-system,"Segoe UI","Noto Sans CJK KR","Noto Sans KR","Apple SD Gothic Neo","Malgun Gothic",sans-serif}
.iso-page{width:100%;margin:0}.iso-figure{margin:0}.iso-plate{padding:46px 18px 44px}
.vs-stage{outline:none;touch-action:pan-y;cursor:ew-resize}.vs-st{cursor:pointer}
.iso[data-theme="light"]{--anatomy-shade-0:#cfcfcc;--anatomy-shade-1:#d9d9d6;--anatomy-shade-2:#e3e3e0;--anatomy-shade-3:#ececea;--anatomy-mid:#76767c;--anatomy-lo:#a4a4a9;--anatomy-faint:#cdcdd0;--anatomy-muted:#6b6b70;
  --vs-lit-top:#8e8e95;--vs-lit-side:#6e6e75;--vs-lit-edge:#000000}
.iso[data-theme="dark"]{--vs-lit-top:#4a4a4a;--vs-lit-side:#333333;--vs-lit-edge:#ffffff}
.vs-st[data-lit] .vs-card>.iso-top{fill:var(--vs-lit-top)}
.vs-st[data-lit] .vs-card>.iso-shade{fill:var(--vs-lit-side)}
.vs-st[data-lit] .vs-card>.iso-edge{stroke:var(--vs-lit-edge);stroke-width:1.6px}
.vs-steps{display:flex;flex-wrap:wrap;gap:6px;margin:10px 0 0}
.vs-steps button{font:inherit;font-size:12.5px;line-height:1.3;padding:5px 10px;border:1px solid var(--anatomy-faint);border-radius:6px;background:var(--anatomy-card);color:var(--anatomy-text);cursor:pointer}
.vs-steps button[aria-pressed="true"]{border-color:var(--anatomy-hi);color:var(--anatomy-strong);font-weight:600}
.vs-note{margin:8px 0 0;padding:7px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:12.5px/1.55 system-ui,sans-serif;color:var(--anatomy-strong)}
.vs-detail{margin:6px 0 0;padding:8px 10px;border:1px solid var(--anatomy-faint);background:var(--anatomy-card);font:11.5px/1.55 var(--anatomy-mono);color:var(--anatomy-strong)}
`;

const DATA = { stages: STAGES.map((s) => ({ ...s, readout: readoutOf(s) })), P };

const LIVE = `
const D = ${JSON.stringify(DATA)};
const P = D.P;
const stage = document.querySelector(".vs-stage");
const shuttle = stage.querySelector('[data-part="shuttle"]');
const v1El = stage.querySelector('[data-part="v1"]');
const v2El = stage.querySelector('[data-part="v2"]');
const sts = [...stage.querySelectorAll(".vs-st")];
const buttons = [...document.querySelectorAll(".vs-steps button")];
const readout = document.querySelector("[data-readout]");
const note = document.querySelector("[data-note]");
const detail = document.querySelector("[data-detail]");
const still = matchMedia("(prefers-reduced-motion: reduce)");
let pick = 2, sx = D.stages[pick].carX, tx = sx, v1z = D.stages[pick].v1Z, v2z = D.stages[pick].v2Z;
let frame = 0, last = 0, clock = 0, visible = false, touring = !still.matches, tourAt = 0, idle = 0, dragging = null;

function draw() {
  shuttle.setAttribute("transform", translateAlong(P, [sx, 0, 0]));
  v1El.setAttribute("transform", translateAlong(P, [0, 0, v1z]));
  v2El.setAttribute("transform", translateAlong(P, [0, 0, Math.max(0, v2z)]));
  sts.forEach((g, i) => g.toggleAttribute("data-lit", i === pick));
}
function select(n) {
  pick = n;
  const s = D.stages[n];
  tx = s.carX;
  readout.textContent = s.readout;
  note.textContent = s.note;
  detail.textContent = s.detail;
  buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === n)));
  run();
}
function tick(now) {
  const dt = last ? Math.min((now - last) / 1000, 1 / 30) : 1 / 60;
  last = now;
  clock += dt;
  if (touring && clock - tourAt > 3.8) { tourAt = clock; select((pick + 1) % D.stages.length); }
  const s = D.stages[pick];
  const ease = (v, to) => still.matches ? to : (Math.abs(to - v) < 0.08 ? to : v + (to - v) * (1 - Math.exp(-dt / 0.2)));
  sx = ease(sx, tx);
  v1z = ease(v1z, s.v1Z);
  v2z = ease(v2z, s.v2Z);
  draw();
  frame = visible && (touring || sx !== tx || v1z !== s.v1Z || v2z !== s.v2Z) ? requestAnimationFrame(tick) : 0;
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
  const g = e.target.closest(".vs-st");
  if (g) { steer(Number(g.dataset.i)); return; }
  dragging = { x0: e.clientX, sx0: tx, moved: false };
  stage.setPointerCapture(e.pointerId);
});
stage.addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const dx = e.clientX - dragging.x0;
  if (Math.abs(dx) > 4) dragging.moved = true;
  tx = Math.max(22, Math.min(152, dragging.sx0 + dx * 0.42));
  let best = 0, bestDist = 999;
  D.stages.forEach((s, idx) => { const d = Math.abs(s.carX - tx); if (d < bestDist) { bestDist = d; best = idx; } });
  if (best !== pick) {
    pick = best;
    const s = D.stages[best];
    readout.textContent = s.readout;
    note.textContent = s.note;
    detail.textContent = s.detail;
    buttons.forEach((b, i) => b.setAttribute("aria-pressed", String(i === best)));
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
const size = () => parent !== window && parent.postMessage({ type: "guide-fig-size", fig: "versioning", height: document.documentElement.scrollHeight }, "*");
addEventListener("load", size);
new ResizeObserver(size).observe(document.body);
`;

const KEYS = [
  { mark: "lit", label: "현재 활성화된 저장소 및 정식 배포 버전 카세트" },
  { mark: "raised", label: "이송 셔틀과 서버 버전 볼트 스태커(v1, v2)" },
];
const CAPTION =
  "자동 저장은 내 브라우저에만, 임시 저장은 서버의 층별 작업 슬롯에만 남습니다. DT 플랫폼으로 실제 파일(TTL · 층별 GeoJSON · GLB)이 배포되는 것은 최초 [구축하기(v1)]와 운영 편집의 [반영하기(v2, v3…)]를 실행할 때뿐입니다.";

function page(theme) {
  const plate = k.plateHtml({
    fig: "Fig 9",
    title: "자동 저장 · 임시 저장 · 구축(v1) · 반영(v2)은 어디에 남나",
    hint: "스테이션을 누르거나 셔틀을 좌우로 드래그해 공유 범위 보기",
    readout: readoutOf(FIRST),
    keys: KEYS,
    caption: CAPTION,
    body: `<div class="iso-stage vs-stage" tabindex="0" role="group" aria-label="4단계 저장 및 버전 스태커 모형">${svg}</div>`,
  });
  const btns = `<div class="vs-steps" role="group" aria-label="저장 단계">${STAGES.map((s) => `<button type="button" aria-pressed="${s === FIRST}">${s.name}</button>`).join("")}</div>`;
  const extra = `${btns}<p class="vs-note" data-note>${FIRST.note}</p><div class="vs-detail" data-detail>${FIRST.detail}</div>`;
  const html = `<style>${CSS}</style>` + plate.replace('<figcaption class="iso-legend">', `${extra}<figcaption class="iso-legend">`);
  return k.pageHtml({ title: "자동 저장 · 임시 저장 · 구축 · 반영은 어디에 남나", theme, body: html, script: kitScript() + LIVE, width: 760 }).replace('<html lang="en">', '<html lang="ko">');
}

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "versioning.html"), page("light"));
writeFileSync(join(OUT, "versioning-dark.html"), page("dark"));
console.log("wrote versioning.html, versioning-dark.html");
