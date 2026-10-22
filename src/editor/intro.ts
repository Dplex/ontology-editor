// 첫 화면 인트로(public/intro/). 서버에 구운 건물 장면(/__data/__intro, scripts/intro-bake.ts)이 있을 때, 주소 끝이 #intro 면
// 파일을 열기 전 첫 화면 위에 띄운다. 그냥 / 로 들어오면 에디터 첫 화면이고, 첫 화면의 [인트로 보기] 가 #intro 로 간다.
// 주소로 가르는 것은 시연할 때 인트로 주소를 따로 걸어 두려고다. 장면이 없는 서버(성수를 굽지 않은 PC)에서는 #intro 여도 띄우지 않는다.
import { ref } from 'vue'

const HASH = '#intro'

/** 구운 장면 이름. 성수가 있으면 성수다(서버가 맨 앞에 둔다). 없으면 null 이고 인트로 링크도 숨는다. */
export const introScene = ref<string | null>(null)
export const introOpen = ref(location.hash === HASH)

addEventListener('hashchange', () => {
  introOpen.value = location.hash === HASH
})

export function loadIntro(): void {
  fetch('./__data/__intro')
    .then((r) => (r.ok ? r.json() : []))
    .then((list: { name: string }[]) => {
      introScene.value = list[0]?.name ?? null
    })
    .catch(() => {
      introScene.value = null
    })
}

/** 주소에서 #intro 를 떼고 닫는다. 기록을 하나 더 쌓지 않아서 뒤로 가기가 인트로로 돌아오지 않는다. */
export function closeIntro(): void {
  introOpen.value = false
  if (location.hash === HASH) history.replaceState(history.state, '', location.pathname + location.search)
}
