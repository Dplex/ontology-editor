<script setup lang="ts">
// 인트로의 조립이 끝나면 오른쪽에 뜨는 들어가기 패널(IntroOverlay.vue). 로그인 화면처럼 보이지만 비밀번호는 없다 —
// 이 앱은 로그인 대신 서버의 사람 목록(data/.users.json, people.ts)에서 사람을 고른다. 여기서 고른 사람이 에디터 위의 사용자 칸과 같은 값이다.
// [계속하기] 는 서버에 아무것도 보내지 않는다 — 고른 이름을 브라우저에 두고(oe.user) 에디터 첫 화면으로 넘어갈 뿐이다.
// 사람 목록이 없는 서버면 고를 것 없이 [에디터 열기] 만 남는다.
import { computed, nextTick, onMounted, ref } from 'vue'
import { currentUser, people } from '../editor/people'
import { josa } from '../lib/josa'

export type IntroMeta = { title: string; files: string[]; place: { name: string; origin: [number, number] } | null }
const props = defineProps<{ meta: IntroMeta }>()
const emit = defineEmits<{ enter: [] }>()

// 이름 옆 영어 역할은 권한 카탈로그(PRD_009)의 이름이다. 우리말 이름(PERSON_ROLE)은 사람 이름 '보기 전용' 과 겹쳐 여기서는 쓰지 않는다.
const ROLE: Record<string, string> = { viewer: 'Viewer', admin: 'Admin', super_admin: 'Super Admin' }
const DOES: Record<string, string> = { viewer: '보기만', admin: '편집 · 반영', super_admin: '편집 · 반영' }
const list = computed(() => people.value ?? [])
const picked = computed(() => list.value.find((p) => p.name === currentUser.value) ?? null)
const ready = computed(() => !people.value || !!picked.value)
const go = computed(() => {
  if (!people.value) return '에디터 열기'
  return picked.value ? `${picked.value.name}${josa(picked.value.name, '으로/로')} 계속하기` : '사람을 골라 주세요'
})
const where = computed(() => {
  const p = props.meta.place
  if (!p) return props.meta.title
  const [lat, lon] = p.origin
  return `${p.name} · ${lat.toFixed(4)}°N ${lon.toFixed(4)}°E`
})

const root = ref<HTMLElement | null>(null)
function pick(name: string) {
  currentUser.value = name
}
function enter() {
  if (ready.value) emit('enter')
}
// ↑↓ 로 사람을 고르고 Enter 로 들어간다. 패널 밖(iframe)에 초점이 있으면 받지 못하므로 뜰 때 패널로 초점을 옮긴다.
function onKey(e: KeyboardEvent) {
  if (e.key === 'Enter') {
    e.preventDefault()
    enter()
    return
  }
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' || !list.value.length) return
  e.preventDefault()
  const i = list.value.findIndex((p) => p.name === currentUser.value)
  const n = list.value.length
  const next = i < 0 ? (e.key === 'ArrowDown' ? 0 : n - 1) : (i + (e.key === 'ArrowDown' ? 1 : n - 1)) % n
  pick(list.value[next].name)
  nextTick(() => root.value?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus())
}
onMounted(() => root.value?.focus())
</script>

<template>
  <aside ref="root" class="signin" tabindex="-1" aria-label="에디터에 들어가기" @keydown="onKey">
    <i class="corner tl" /><i class="corner tr" /><i class="corner bl" /><i class="corner br" />
    <i class="sweep" aria-hidden="true" />
    <i class="beam" aria-hidden="true" />

    <header class="brand">
      <svg class="mark" viewBox="0 0 32 32" aria-hidden="true">
        <path d="M16 3 28 10v12L16 29 4 22V10Z" fill="none" stroke="currentColor" stroke-width="1.4" />
        <path d="M4 10l12 7 12-7M16 17v12" fill="none" stroke="currentColor" stroke-width="1.4" opacity=".55" />
        <circle cx="16" cy="17" r="2.2" fill="currentColor" />
      </svg>
      <span class="name">Ontology Editor</span>
      <span class="status" :class="{ off: !people }">
        <i />{{ people ? '연결됨' : '사람 목록 없음' }}
      </span>
    </header>

    <div class="head">
      <p class="eyebrow">BIM → DT ONTOLOGY</p>
      <h2 v-if="people">누구로 시작할까요?</h2>
      <h2 v-else>에디터로 갈까요?</h2>
      <p class="lede" v-if="people">고른 이름이 저장과 반영 기록에 남습니다.</p>
      <p class="lede" v-else>이 서버에는 사람 목록이 없어 바로 들어갑니다.</p>
    </div>

    <div v-if="people" class="people" role="radiogroup" aria-label="사람">
      <button
        v-for="p in list"
        :key="p.name"
        type="button"
        role="radio"
        class="person"
        :aria-checked="p.name === currentUser"
        :tabindex="p.name === currentUser || (!picked && p === list[0]) ? 0 : -1"
        @click="pick(p.name)"
        @dblclick="pick(p.name), enter()"
      >
        <span class="avatar" :data-role="p.role">{{ p.name.slice(0, 1) }}</span>
        <span class="who">
          <b>{{ p.name }}</b>
          <small>{{ DOES[p.role] }}</small>
        </span>
        <span class="role">{{ ROLE[p.role] }}</span>
        <svg class="check" viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
      </button>
    </div>

    <button type="button" class="enter" :disabled="!ready" @click="enter">
      <span>{{ go }}</span>
      <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 8h10M9 4l4 4-4 4" /></svg>
    </button>

    <footer>
      <p class="keys"><kbd>↑</kbd><kbd>↓</kbd> 선택 <kbd>Enter</kbd> 계속 <kbd>Esc</kbd> 건너뛰기</p>
      <p class="tele">{{ where }}</p>
    </footer>
  </aside>
</template>

<style scoped>
.signin {
  --ink: #eef1f4;
  --mute: #8d96a3;
  --faint: rgba(255, 255, 255, 0.08);
  --accent: #8bd3ff;
  --ok: #6ee7b7;
  position: absolute;
  right: clamp(16px, 4.2vw, 72px);
  top: 50%;
  translate: 0 -50%;
  width: min(392px, calc(100vw - 32px));
  max-height: calc(100vh - 140px);
  overflow: auto;
  padding: 28px 28px 22px;
  box-sizing: border-box;
  color: var(--ink);
  font: 400 14px/1.5 Inter, system-ui, -apple-system, sans-serif;
  border-radius: 22px;
  /* 유리: 뒤 장면을 흐리고 채도를 올린 위에, 윗변 반사광 한 줄과 안쪽 테두리로 두께를 준다. */
  background:
    radial-gradient(120% 60% at 0% 0%, rgba(139, 211, 255, 0.10), transparent 60%),
    linear-gradient(180deg, rgba(22, 26, 32, 0.72), rgba(12, 14, 18, 0.78));
  backdrop-filter: blur(22px) saturate(150%);
  -webkit-backdrop-filter: blur(22px) saturate(150%);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.14),
    inset 0 0 0 1px rgba(255, 255, 255, 0.07),
    0 24px 80px -20px rgba(0, 0, 0, 0.7);
  animation: rise 0.7s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
/* 패널은 키(↑↓·Enter)를 받으려고 뜰 때 초점만 가져온다. 누를 것이 아니라서 shell.css 의 초점 테두리(!important)를 걷는다. */
.signin:focus,
.signin:focus-visible {
  outline: none !important;
}
.signin > * {
  animation: rise 0.6s cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
.signin > .brand { animation-delay: 0.08s; }
.signin > .head { animation-delay: 0.14s; }
.signin > .people { animation-delay: 0.2s; }
.signin > .enter { animation-delay: 0.26s; }
.signin > footer { animation-delay: 0.32s; }
@keyframes rise {
  from { opacity: 0; transform: translateY(10px); filter: blur(4px); }
}

/* 테두리를 따라 도는 빛 한 줄. 조건부 속성(@property)으로 각도를 움직여 테두리 1px 만 보이게 깎는다. */
@property --beam {
  syntax: '<angle>';
  inherits: false;
  initial-value: 0deg;
}
.beam {
  position: absolute;
  inset: 0;
  padding: 1px;
  border-radius: inherit;
  background: conic-gradient(from var(--beam), transparent 0 78%, rgba(139, 211, 255, 0.9) 88%, rgba(110, 231, 183, 0.6) 92%, transparent 96%);
  -webkit-mask: linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0);
  -webkit-mask-composite: xor;
  mask-composite: exclude;
  pointer-events: none;
  animation: beam 7s linear infinite !important;
}
@keyframes beam {
  to { --beam: 360deg; }
}
/* 모서리 눈금: 3D 뷰포트의 조준 틀. */
.corner {
  position: absolute;
  width: 10px;
  height: 10px;
  border: 0 solid rgba(139, 211, 255, 0.45);
  animation: none;
}
.corner.tl { top: 10px; left: 10px; border-top-width: 1px; border-left-width: 1px; }
.corner.tr { top: 10px; right: 10px; border-top-width: 1px; border-right-width: 1px; }
.corner.bl { bottom: 10px; left: 10px; border-bottom-width: 1px; border-left-width: 1px; }
.corner.br { bottom: 10px; right: 10px; border-bottom-width: 1px; border-right-width: 1px; }
/* 앞머리의 스캔선을 패널에서 한 번 더: 뜰 때 위에서 아래로 한 번 훑는다. */
.sweep {
  position: absolute;
  inset: 0 0 auto;
  height: 1px;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  box-shadow: 0 0 12px 1px rgba(139, 211, 255, 0.5);
  opacity: 0;
  animation: sweep 1.3s 0.15s ease-in-out both;
  pointer-events: none;
}
@keyframes sweep {
  0% { top: 0; opacity: 0; }
  15% { opacity: 1; }
  85% { opacity: 0.8; }
  100% { top: 100%; opacity: 0; }
}

.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.mark {
  width: 22px;
  height: 22px;
  color: var(--accent);
}
.name {
  font-weight: 600;
  letter-spacing: -0.01em;
}
.status {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 3px 9px;
  border-radius: 999px;
  background: rgba(110, 231, 183, 0.08);
  color: #b8f0d8;
  font: 500 11.5px/1.4 Inter, system-ui, sans-serif;
}
.status i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--ok);
  box-shadow: 0 0 0 0 rgba(110, 231, 183, 0.6);
  animation: pulse 2.4s ease-out infinite;
}
.status.off { background: var(--faint); color: var(--mute); }
.status.off i { background: var(--mute); animation: none; }
@keyframes pulse {
  70% { box-shadow: 0 0 0 6px rgba(110, 231, 183, 0); }
  100% { box-shadow: 0 0 0 0 rgba(110, 231, 183, 0); }
}

.head {
  margin: 26px 0 18px;
}
.eyebrow {
  margin: 0 0 6px;
  color: var(--accent);
  font: 500 11px/1 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.14em;
}
h2 {
  margin: 0;
  font: 600 27px/1.25 Inter, system-ui, -apple-system, sans-serif;
  letter-spacing: -0.03em;
  text-wrap: balance;
}
.lede {
  margin: 8px 0 0;
  text-wrap: pretty;
  color: var(--mute);
  font-size: 13px;
}

.people {
  display: grid;
  gap: 6px;
}
.person {
  display: grid;
  grid-template-columns: 34px 1fr auto 16px;
  align-items: center;
  gap: 12px;
  width: 100%;
  padding: 10px 12px;
  border: 1px solid var(--faint);
  border-radius: 14px;
  background: rgba(255, 255, 255, 0.025);
  color: inherit;
  font: inherit;
  text-align: left;
  cursor: pointer;
  transition: background 0.15s, border-color 0.15s;
}
.person:hover {
  background: rgba(255, 255, 255, 0.05);
}
.person:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.person[aria-checked='true'] {
  border-color: rgba(139, 211, 255, 0.55);
  background: rgba(139, 211, 255, 0.07);
}
.avatar {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 50%;
  background: linear-gradient(140deg, #2a3442, #161b22);
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.1);
  font-weight: 600;
  font-size: 13px;
}
.avatar[data-role='super_admin'] { background: linear-gradient(140deg, #24435a, #142130); }
.avatar[data-role='viewer'] { background: linear-gradient(140deg, #2b2d31, #18191c); color: var(--mute); }
.who {
  display: grid;
  line-height: 1.3;
}
.who b { font-weight: 550; }
.who small { color: var(--mute); font-size: 12px; }
.role {
  color: var(--mute);
  font: 500 10.5px/1 'JetBrains Mono', ui-monospace, monospace;
  letter-spacing: 0.04em;
}
.check {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: var(--accent);
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  opacity: 0;
  transition: opacity 0.15s;
}
.person[aria-checked='true'] .check { opacity: 1; }

.enter {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  width: 100%;
  margin-top: 18px;
  padding: 13px 16px;
  border: 0;
  border-radius: 14px;
  background: linear-gradient(180deg, #f4f7fa, #dde4ea);
  color: #0d0f12;
  font: 600 14px/1 Inter, system-ui, sans-serif;
  cursor: pointer;
  box-shadow: inset 0 1px 0 #fff, 0 8px 24px -10px rgba(139, 211, 255, 0.6);
  transition: transform 0.15s, box-shadow 0.15s, opacity 0.15s;
}
.enter svg {
  width: 16px;
  height: 16px;
  fill: none;
  stroke: currentColor;
  stroke-width: 1.8;
  stroke-linecap: round;
  stroke-linejoin: round;
  transition: transform 0.15s;
}
.enter:hover:not(:disabled) svg { transform: translateX(3px); }
.enter:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.enter:disabled {
  opacity: 0.35;
  cursor: default;
  box-shadow: none;
}

footer {
  margin-top: 18px;
  padding-top: 14px;
  border-top: 1px solid var(--faint);
  color: var(--mute);
  font: 400 11px/1.6 'JetBrains Mono', ui-monospace, monospace;
}
footer p { margin: 0; }
.keys kbd {
  display: inline-block;
  min-width: 14px;
  margin: 0 2px;
  padding: 1px 5px;
  border-radius: 5px;
  background: var(--faint);
  color: var(--ink);
  font: inherit;
  text-align: center;
}
.keys kbd + kbd { margin-left: 0; }
.tele {
  margin-top: 4px !important;
  color: #5f6873;
}

@media (prefers-reduced-motion: reduce) {
  .signin, .signin > *, .sweep, .status i, .beam { animation: none !important; }
}
@media (max-width: 720px) {
  .signin { top: auto; bottom: 16px; translate: none; left: 16px; right: 16px; width: auto; }
}
</style>
