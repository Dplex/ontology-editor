// B. 청사진(blueprint) — 3D 칸을 짙은 청 바탕의 도면처럼 보인다(docs/plans/easter-eggs.md).
//
// - 바탕은 짙은 청, 벽·가구의 모서리 선(model-edges.ts 가 이미 뽑아 둔 선)은 흰 선, 면은 거의 투명, 바닥 격자는 흰 제도 격자,
//   설비는 옅은 흰 면이다. 설비 모서리는 뽑지 않는다(성수 설비는 정점 1천만 개라 model-edges 도 설비에는 긋지 않는다).
// - 다크·라이트 어느 쪽에서 켜도 같은 청사진이다. 테마를 바꾸면 뷰어가 모서리·격자 색을 다시 칠하므로 그 뒤에 다시 입힌다.
// - 장면의 재질을 잠깐 바꿨다가 끄면 하나하나 되돌린다(재질별로 바꾸기 전 값을 들고 있다). 형상은 건드리지 않는다.
//   편집으로 새 재질이 생기면(modelVersion) 그것에도 입힌다.
import { Color, LineBasicMaterial, LineSegments, type Material, Mesh, MeshLambertMaterial, MeshBasicMaterial, Object3D, ShaderMaterial, type Scene } from 'three'
import { watch } from 'vue'
import type { EggContext, EggHandle } from './types'

export const PAPER = 0x0d2a4a
const INK = 0xffffff
const GRID_INK = 0xa9c6ee
/** 면(벽·판·가구)의 불투명도. 거의 투명해서 선만 읽히되, 겹친 면의 깊이감은 남는다. */
const FACE_OPACITY = 0.05
/** 설비 면의 불투명도. 옅은 흰 면이다. */
const DEVICE_OPACITY = 0.22

type SavedSurface = { transparent: boolean; opacity: number; depthWrite: boolean; vertexColors: boolean; color: number | null }
type SavedLine = { color: number; opacity: number; transparent: boolean }
type SavedGrid = { color: number; minor: number; major: number }

/** 고칠 수 있는 면 재질인가. 직접 쓴 셰이더(흐르는 빛·바닥 격자·하늘)와 다른 종류는 건드리지 않는다. */
export function isSurface(m: Material): m is MeshLambertMaterial | MeshBasicMaterial {
  return m instanceof MeshLambertMaterial || m instanceof MeshBasicMaterial
}

export function enable(ctx: EggContext): EggHandle {
  const anchor = new Object3D()
  const surfaces = new Map<MeshLambertMaterial | MeshBasicMaterial, SavedSurface>()
  const lines = new Map<LineBasicMaterial, SavedLine>()
  const grids = new Map<ShaderMaterial, SavedGrid>()
  let background: { value: Scene['background'] } | null = null
  let pending = true

  function paint(scene: Scene) {
    if (!background) background = { value: scene.background }
    scene.background = new Color(PAPER)
    scene.traverse((o) => {
      if (o instanceof LineSegments && o.userData.edges) {
        const m = o.material as LineBasicMaterial
        if (!lines.has(m)) lines.set(m, { color: m.color.getHex(), opacity: m.opacity, transparent: m.transparent })
        m.color.setHex(INK)
        m.opacity = 0.85
        m.transparent = true
        return
      }
      if (!(o instanceof Mesh)) return
      const mats = ([] as Material[]).concat(o.material)
      if (o.userData.groundGrid) {
        for (const m of mats) {
          if (!(m instanceof ShaderMaterial)) continue
          const u = m.uniforms
          if (!grids.has(m)) grids.set(m, { color: (u.color.value as Color).getHex(), minor: u.minorAlpha.value, major: u.majorAlpha.value })
          ;(u.color.value as Color).setHex(GRID_INK)
          u.minorAlpha.value = 0.16
          u.majorAlpha.value = 0.4
        }
        return
      }
      for (const m of mats) {
        if (!m || !isSurface(m)) continue
        if (!surfaces.has(m)) {
          surfaces.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite, vertexColors: m.vertexColors, color: m.color.getHex() })
        }
        // 꼭짓점 색은 설비 덩어리뿐이다(계통 색). 그것을 설비 면으로 본다.
        const device = surfaces.get(m)!.vertexColors
        if (m.vertexColors || !m.transparent) m.needsUpdate = true
        m.vertexColors = false
        m.color.setHex(INK)
        m.transparent = true
        m.depthWrite = false
        // 흐리게 한 것(0.08)은 더 옅게만 — 청사진이 흐린 설비를 도로 짙게 보이면 안 된다.
        m.opacity = Math.min(device ? DEVICE_OPACITY : FACE_OPACITY, surfaces.get(m)!.opacity)
      }
    })
  }

  function restore() {
    for (const [m, s] of surfaces) {
      if (m.vertexColors !== s.vertexColors || m.transparent !== s.transparent) m.needsUpdate = true
      m.transparent = s.transparent
      m.opacity = s.opacity
      m.depthWrite = s.depthWrite
      m.vertexColors = s.vertexColors
      if (s.color !== null) m.color.setHex(s.color)
    }
    for (const [m, s] of lines) {
      m.color.setHex(s.color)
      m.opacity = s.opacity
      m.transparent = s.transparent
    }
    for (const [m, s] of grids) {
      ;(m.uniforms.color.value as Color).setHex(s.color)
      m.uniforms.minorAlpha.value = s.minor
      m.uniforms.majorAlpha.value = s.major
    }
    const scene = anchor.parent as Scene | null
    if (scene && background) scene.background = background.value
    surfaces.clear()
    lines.clear()
    grids.clear()
    background = null
  }

  // 새 재질(편집 뒤 다시 지은 것)과, 테마를 바꿔 뷰어가 되칠한 모서리·격자에 다시 입힌다. 바꾸기 전 값은 처음 본 것을 그대로 둔다.
  const stopModel = watch(() => ctx.modelVersion(), () => (pending = true))
  const stopDark = watch(
    () => ctx.dark(),
    () => {
      // 뷰어가 테마 색을 칠한 뒤의 값이 "원래 값" 이다. 끌 때 그 테마의 색으로 돌아가게 선·격자의 기억을 새로 잡는다.
      lines.clear()
      grids.clear()
      pending = true
    },
  )

  ctx.addLayer({
    object: anchor,
    step() {
      if (!pending) return false
      const scene = anchor.parent as Scene | null
      if (!scene) return false
      pending = false
      paint(scene)
      return true
    },
    dispose: restore,
  })

  return {
    off() {
      stopModel()
      stopDark()
    },
    inspect: () => ({ surfaces: surfaces.size, lines: lines.size, grids: grids.size, background: (anchor.parent as Scene | null)?.background instanceof Color }),
  }
}
