// 숨은 연출 목록. 순서가 `~` 판의 숫자 키(1~9)다. 새 egg 는 여기 한 줄과 src/eggs/<id>.ts 하나로 붙는다(docs/plans/easter-eggs.md).
import type { Egg } from './types'

export const EGGS: readonly Egg[] = [
  { id: 'xray', title: '온톨로지 투시', load: () => import('./xray') },
  { id: 'alive', title: '살아 있는 건물', load: () => import('./alive') },
  { id: 'pass', title: '기준선 통과', load: () => import('./pass') },
  { id: 'sun', title: '해가 지나가는 건물', load: () => import('./sun') },
  { id: 'refine', title: '멈추면 차오르는 화질', load: () => import('./refine') },
  { id: 'shadow', title: '바닥에 앉는 그림자', load: () => import('./shadow') },
  { id: 'rise', title: '층이 올라앉는 오프닝', load: () => import('./rise') },
  { id: 'wipe', title: '테마 원형 번짐', load: () => import('./wipe') },
  { id: 'blueprint', title: '청사진', load: () => import('./blueprint') },
  { id: 'heat', title: '풍량 밀도', load: () => import('./heat') },
  // 시험용 본보기(probe.ts). e2e 에서만 든다 — 빌드에서는 이 갈래가 상수로 접혀 사라진다.
  ...(import.meta.env.MODE === 'e2e' ? [{ id: 'probe', title: '시험용 본보기', load: () => import('./probe') }] : []),
]
