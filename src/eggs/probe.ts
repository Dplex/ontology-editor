// 시험용 egg. e2e 에서만 목록에 들고(registry.ts), e2e/eggs.spec.ts 가 껍데기의 약속(끄면 층·메모리·빛·HUD 가 켜기 전으로,
// 가만히 있으면 0장, 모델·TTL 은 그대로)을 이것으로 잰다. 새 egg 의 본보기이기도 하다 — 3D 층 하나, 빛 바꾸기, HUD 한 줄, 신호 읽기.
import { BoxGeometry, Mesh, MeshBasicMaterial } from 'three'
import { watch } from 'vue'
import type { EggContext, EggHandle } from './types'

export function enable(ctx: EggContext): EggHandle {
  const geometry = new BoxGeometry(1, 1, 1)
  const material = new MeshBasicMaterial({ color: 0x5457c4, wireframe: true })
  const mesh = new Mesh(geometry, material)
  mesh.position.y = 1
  const t0 = performance.now()
  let frames = 0
  ctx.addLayer({
    object: mesh,
    // 도는 동안만 다시 그리게 한다. 움직임을 끈 사람에게는 돌리지 않는다 — 얹을 때 한 장 그리고 0장이다.
    step(now) {
      if (ctx.still()) return false
      mesh.rotation.y = (now - t0) / 600
      frames++
      return true
    },
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  })
  ctx.lights({ hemi: 0.5 })

  const hud = ctx.hud
  hud.style.cssText = 'position:absolute;left:0.75rem;bottom:0.75rem;font:12px ui-monospace,monospace;color:var(--muted)'
  const paint = (n: number) => (hud.textContent = `probe · 완전성 검사 위반 ${n} · 화면에서만`)
  paint(ctx.signals.violations.value)
  const stop = watch(ctx.signals.violations, paint)

  // 빛·층·HUD 는 껍데기가 거둔다. egg 가 직접 건 것(watch)만 여기서 푼다.
  return { off: stop, inspect: () => ({ frames, hud: hud.textContent }) }
}
