// 첫 화면 인트로(public/intro/). 서버에 구운 건물 장면(/__data/__intro, scripts/intro-bake.ts)이 있으면, 파일을 열기 전
// 첫 화면에 한 번 띄운다. 닫으면 이 탭에서는 다시 띄우지 않고, 첫 화면의 [인트로] 로 다시 본다.
// 장면이 없는 서버(성수를 굽지 않은 PC)에서는 아무것도 띄우지 않는다.
import { ref } from 'vue'

const SEEN = 'oe-intro-seen'

/** 구운 장면 이름. 성수가 있으면 성수다(서버가 맨 앞에 둔다). 없으면 null 이고 인트로 링크도 숨는다. */
export const introScene = ref<string | null>(null)
export const introOpen = ref(false)

export function loadIntro(): void {
  fetch('./__data/__intro')
    .then((r) => (r.ok ? r.json() : []))
    .then((list: { name: string }[]) => {
      introScene.value = list[0]?.name ?? null
      if (!introScene.value) return
      let seen = false
      try {
        seen = sessionStorage.getItem(SEEN) === '1'
      } catch {
        // 저장소를 못 쓰는 브라우저면 매번 띄운다.
      }
      introOpen.value = !seen
    })
    .catch(() => {
      introScene.value = null
    })
}

export function closeIntro(): void {
  introOpen.value = false
  try {
    sessionStorage.setItem(SEEN, '1')
  } catch {
    // 위와 같다.
  }
}
