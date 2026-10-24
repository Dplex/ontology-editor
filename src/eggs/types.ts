// 숨은 연출(egg) 한 개가 받는 것과 내놓는 것(docs/plans/easter-eggs.md 3장).
//
// egg 는 편집기 상태를 import 하지 않고 EggContext 로만 읽는다. 고치는 함수는 하나도 넘기지 않는다 — 화면 연출이 모델·편집 파일·
// TTL 을 바꾸는 길을 아예 두지 않으려는 것이다(eggs.test.ts 가 import 를 훑어 막는다).
import type { Ref } from 'vue'
import type { Model } from '../lib/model'
import type { ViewerLayer } from '../lib/viewer'

/** 3D 에 얹는 층. 뷰어의 것 그대로다(lib/viewer.ts 의 ViewerLayer). */
export type SceneLayer = ViewerLayer

/** 화면이 이미 센 값. egg 가 다시 재지 않는다. */
export type EggSignals = {
  /** 완전성 검사 위반 수(잴 대상이 없어 건너뛴 규칙은 빼고). 리플레이 동안은 열기 전 값이다. */
  violations: Readonly<Ref<number>>
  /** 수용 기준선(구축하기 게이트)을 넘었나. 아직 재지 않았으면 null. */
  accepted: Readonly<Ref<boolean | null>>
  flying: Readonly<Ref<boolean>>
  replaying: Readonly<Ref<boolean>>
  /** 한 층만 보고 있으면 그 층 id, 모든 층이면 null. */
  storeyId: Readonly<Ref<string | null>>
}

export type EggContext = {
  /** 지금 모델. 읽기만 한다. */
  model(): Readonly<Model> | null
  /** 모델이 바뀌거나(새 파일·편집) 3D 를 다시 그리면 오른다. 지어 둔 것을 버릴 때를 이것으로 안다. */
  modelVersion(): number
  /** 3D 에 층을 얹는다. 돌려준 함수로 일찍 뗄 수 있고, 안 떼도 egg 를 끄면 껍데기가 뗀다. */
  addLayer(layer: SceneLayer): () => void
  /** 바탕 빛(하늘빛·카메라 주광)의 세기를 잠시 바꾼다. 끄면 껍데기가 되돌린다. */
  lights(o: { hemi?: number; sun?: number }): () => void
  /** 넓게 보기(Ctrl+\)를 켜고 끈다. egg 가 켰으면 끌 때 껍데기가 같이 끈다. */
  wide(on: boolean): void
  /** 움직임 끄기(prefers-reduced-motion)·안 보이는 탭이면 참. 참이면 이동·확대를 빼고 결과 상태만 보인다. */
  still(): boolean
  dark(): boolean
  /** 이 egg 의 HUD 자리(3D 칸을 덮는 상자 안, pointer-events: none). 처음 읽을 때 생기고 끄면 지워진다. */
  readonly hud: HTMLElement
  readonly signals: EggSignals
}

export type EggHandle = {
  /** 끌 때 한 번. 껍데기가 이것을 부른 뒤 남은 층·빛·HUD 를 거둔다. */
  off(): void
  /** e2e·콘솔이 들여다볼 값(`__oe.eggs().inspect.<id>`). HUD 의 수와 파일의 수를 견줄 때 쓴다. */
  inspect?(): unknown
}

/** egg 모듈 하나(src/eggs/<id>.ts)가 내보내는 것. */
export type EggModule = { enable(ctx: EggContext): EggHandle | Promise<EggHandle> }

export type Egg = {
  /** 주소(`?egg=`)·콘솔 이름. 소문자 한 단어. */
  id: string
  /** 우리말 이름(`~` 판, 콘솔 표). */
  title: string
  /** 동적 import 라 켜기 전에는 내려받지도 않는다 — 기본 번들 크기가 그대로다. */
  load(): Promise<EggModule>
}
