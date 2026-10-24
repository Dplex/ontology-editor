// 숨은 연출 목록. 순서가 `~` 판의 숫자 키(1~9)다. 새 egg 는 여기 한 줄과 src/eggs/<id>.ts 하나로 붙는다(docs/plans/easter-eggs.md).
import type { Egg } from './types'

export const EGGS: readonly Egg[] = [
  // 시험용 본보기(probe.ts). e2e 에서만 들고, `~` 판의 숫자 키 시험이 1 로 누르도록 맨 앞에 둔다. 빌드에서는 이 갈래가 상수로 접혀 사라진다.
  ...(import.meta.env.MODE === 'e2e' ? [{ id: 'probe', title: '시험용 본보기', hint: '켜면 HUD 한 줄', load: () => import('./probe') }] : []),
  { id: 'xray', title: '온톨로지 투시', hint: '켜면 바로 · 3D 위에서 Space 를 누르고 있으면 다시 섬', load: () => import('./xray') },
  { id: 'alive', title: '살아 있는 건물', hint: '켜면 바로 feeds 가 흐름', load: () => import('./alive') },
  { id: 'pass', title: '기준선 통과', hint: '편집으로 위반이 0 이 되는 순간 한 번', load: () => import('./pass') },
  { id: 'sun', title: '해가 지나가는 건물', hint: '왼쪽 아래 막대로 날짜·시각을 끈다', load: () => import('./sun') },
  { id: 'refine', title: '멈추면 차오르는 화질', hint: '시점을 멈추면 얇은 선의 계단이 메워짐', load: () => import('./refine') },
  { id: 'shadow', title: '바닥에 앉는 그림자', hint: '건물 발밑 · 낮은 각도에서 보임', load: () => import('./shadow') },
  { id: 'rise', title: '층이 올라앉는 오프닝', hint: '켤 때와 새 파일을 열 때 한 번', load: () => import('./rise') },
  { id: 'wipe', title: '테마 원형 번짐', hint: '오른쪽 위 테마 단추를 누르면', load: () => import('./wipe') },
  { id: 'blueprint', title: '청사진', hint: '켜면 바로', load: () => import('./blueprint') },
  { id: 'heat', title: '풍량 밀도', hint: '물리존 바닥 · 말단에 정격 풍량이 있어야 칠해짐', load: () => import('./heat') },
  { id: 'title', title: '방 이름 자막', hint: '비행(G) 중 방에 들어서면', load: () => import('./title') },
  { id: 'cube', title: '방향 큐브 튕기기', hint: '방향 큐브를 세게 끌다 놓으면', load: () => import('./cube') },
  { id: 'tour', title: '계통을 따라가는 대기 화면', hint: '10초 손을 떼면 시작 · 아무 입력에 멈춤', load: () => import('./tour') },
  { id: 'ticker', title: '읽는 중인 IFC 클래스', hint: '켠 채로 파일을 열면 진행 알림 곁에', load: () => import('./ticker'), early: true },
]
