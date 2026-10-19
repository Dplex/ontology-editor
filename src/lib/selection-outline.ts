// --- 고른 것의 외곽선 ---
//
// 고른 설비·오브젝트·벽의 윤곽에 강조색 선을 두르고, 그 바깥으로 옅은 빛을 번지게 한다. 색만 바꿔 칠하던 때는 종류별 색·출처 색으로
// 보는 중에 고르면 그 설비의 색이 지워졌고, 라디에이터처럼 작은 설비는 고른 색이 점 하나라 어디 있는지 찾아야 했다.
// ArtCraft(storytold/artcraft)의 SelectionOutlinePass 에서 가져왔다(reference.md). 그쪽은 장면 전체를 후처리 체인으로 두 번 그리는데,
// 여기서는 장면은 그대로 한 번 그리고 고른 것만 따로 그린다 — 성수 설비가 정점 1천만 개라 장면을 한 번 더 그리면 시점을 돌릴 때마다 값이 든다.
//
// 1. 고른 것만 OUTLINE_LAYER 에 올려 두고, 그 층만 흰색으로 마스크 타깃에 그린다. 깊이 검사를 끄므로 벽·천장에 가려도 마스크에 든다
//    (천장 속 덕트를 고르면 가린 것 너머로 윤곽이 보인다).
// 2. 화면 크기 사각형 하나로 마스크를 읽어, 마스크 밖이면서 가까이에 마스크가 있는 픽셀에만 선·빛을 칠한다. 안쪽은 버려서 고른 것은 제 색 그대로다.
// 두 단계 다 고른 것의 화면 상자(+ 빛 반경)로 가위질(scissor)한다. 고른 것이 작으면 화면의 일부만 칠한다.
//
// 고르는 순간 빛이 넓게 퍼졌다가 0.28초 안에 제자리로 줄어든다(flash). 자주 하는 동작이라 기다리게 하지 않는 길이다(디자인 시스템 A6).
// 움직임을 끈 사람에게는 바로 제자리다. 계속 숨 쉬듯 깜박이게 하지 않는다 — 깜박이는 동안 3D 를 매 프레임 다시 그려야 한다.

import {
  Box3,
  Color,
  Mesh,
  MeshBasicMaterial,
  NearestFilter,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  ShaderMaterial,
  Vector2,
  Vector3,
  WebGLRenderTarget,
  type Camera,
  type Object3D,
  type WebGLRenderer,
} from 'three'
import { easeOut, still } from './motion'

/** 외곽선을 그릴 것만 올리는 층. 0 은 보통 장면이고, 낮은 번호는 three.js 기본 도구가 쓸 수 있어 끝 번호를 쓴다. */
export const OUTLINE_LAYER = 30
/** 미리 강조(HOVER_STYLE)의 층. 고른 것과 층이 같으면 두 마스크에 서로가 섞여 그려진다. */
export const HOVER_LAYER = 29
/** 겹쳐서 막은 상대(CONFLICT_STYLE)의 층. */
export const CONFLICT_LAYER = 28
const FLASH_MS = 280
/**
 * 외곽선 모양. 선 두께·빛 반경은 CSS 픽셀이고 기기 픽셀비를 곱해 쓴다. `flash` 는 고르는 순간 퍼지는 빛 반경(없으면 퍼지지 않는다).
 * `opacity` 는 선·빛 전체에 곱한다.
 */
export type OutlineStyle = { line: number; glow: number; flash: number | null; opacity: number; colors: { light: number; dark: number } }
/** 고른 것. 강조색(디자인 시스템 A2 의 --accent)이고 라이트·다크가 다르다. */
export const SELECTED_STYLE: OutlineStyle = { line: 2, glow: 9, flash: 18, opacity: 1, colors: { light: 0x5457c4, dark: 0x8b8ef0 } }
/**
 * 커서 아래에서 누르면 골라질 것(미리 강조, OE-UI-27). 고른 것과 구별되게 같은 강조색을 옅고 가늘게 쓰고 빛은 좁게, 퍼지지 않는다
 * (OE-UI-17 "고른 것의 강조와 구별되는 옅은 강조색"). 커서를 따라 자주 바뀌니 움직이면 시끄럽다.
 */
export const HOVER_STYLE: OutlineStyle = { line: 1.5, glow: 5, flash: null, opacity: 0.6, colors: { light: 0x5457c4, dark: 0x8b8ef0 } }
/**
 * 겹쳐서 막은 상대(OE-SPC-15). 디자인 시스템의 위험 색이다(다크 `--error` #f08076, 라이트는 3D 가 써 온 #d1372b). 막히는 순간 빛이 퍼진다.
 * 놓기 전 미리보기가 겹치는 자리에 있을 때도 이 선이 상대를 짚는다(그때는 같은 상대가 이어지는 동안 다시 퍼지지 않는다).
 */
export const CONFLICT_STYLE: OutlineStyle = { line: 2, glow: 9, flash: 18, opacity: 1, colors: { light: 0xd1372b, dark: 0xf08076 } }

/** 빛 반경의 상한(드로잉 버퍼 픽셀). 셰이더가 이만큼 좌우·위아래를 훑는다. */
const MAX_RADIUS = 24
const vertexShader = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }'
// 마스크까지의 거리를 가로 → 세로 두 번에 잰다(분리 가능한 거리 변환). 가로 단계는 픽셀마다 같은 줄에서 가장 가까운 마스크까지의
// 가로 거리를, 세로 단계는 그 값을 위아래로 훑어 실제 거리 √(dx² + dy²) 의 최솟값을 낸다. 방향 몇 개만 찍어 보면 작은 설비 둘레에서
// 빛이 점선처럼 끊긴다.
const horizontalShader = /* glsl */ `
  uniform sampler2D tMask;
  uniform vec2 texel;
  uniform float radius;
  varying vec2 vUv;
  void main() {
    float dx = 255.0;
    for (int i = 0; i <= ${MAX_RADIUS}; i++) {
      float fi = float(i);
      if (fi > radius || fi >= dx) break;
      if (texture2D(tMask, vUv + vec2(fi * texel.x, 0.0)).r > 0.5 || texture2D(tMask, vUv - vec2(fi * texel.x, 0.0)).r > 0.5) dx = fi;
    }
    gl_FragColor = vec4(dx / 255.0, 0.0, 0.0, 1.0);
  }
`
const verticalShader = /* glsl */ `
  uniform sampler2D tMask;
  uniform sampler2D tRow;
  uniform vec2 texel;
  uniform float line;
  uniform float glow;
  uniform vec3 color;
  uniform float opacity;
  varying vec2 vUv;
  void main() {
    if (texture2D(tMask, vUv).r > 0.5) discard;
    float d = 1e3;
    for (int j = -${MAX_RADIUS}; j <= ${MAX_RADIUS}; j++) {
      float fj = float(j);
      if (abs(fj) > glow) continue;
      float dx = texture2D(tRow, vUv + vec2(0.0, fj * texel.y)).r * 255.0;
      if (dx < 254.5) d = min(d, sqrt(dx * dx + fj * fj));
    }
    if (d > glow) discard;
    // 선 안쪽은 가득, 바깥 빛은 반경까지 제곱으로 빠진다. 선 가장자리 1px 은 부드럽게 넘긴다(계단 무늬).
    float core = 1.0 - smoothstep(line - 0.5, line + 0.5, d);
    float halo = 0.6 * pow(max(0.0, 1.0 - (d - line) / max(glow - line, 1.0)), 2.0);
    gl_FragColor = vec4(color, max(core, halo) * opacity);
  }
`

export type SelectionOutline = ReturnType<typeof createSelectionOutline>

export function createSelectionOutline(renderer: WebGLRenderer, style: OutlineStyle = SELECTED_STYLE, layer = OUTLINE_LAYER) {
  const LINE_PX = style.line
  const GLOW_PX = style.glow
  const target = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false })
  const rows = new WebGLRenderTarget(1, 1, { minFilter: NearestFilter, magFilter: NearestFilter, depthBuffer: false })
  const maskMaterial = new MeshBasicMaterial({ color: 0xffffff, depthTest: false, depthWrite: false })
  const horizontal = new ShaderMaterial({
    uniforms: { tMask: { value: target.texture }, texel: { value: new Vector2(1, 1) }, radius: { value: GLOW_PX } },
    vertexShader,
    fragmentShader: horizontalShader,
    depthTest: false,
    depthWrite: false,
  })
  const material = new ShaderMaterial({
    uniforms: {
      tMask: { value: target.texture },
      tRow: { value: rows.texture },
      texel: { value: new Vector2(1, 1) },
      line: { value: LINE_PX },
      glow: { value: GLOW_PX },
      color: { value: new Color(style.colors.light) },
      opacity: { value: style.opacity },
    },
    vertexShader,
    fragmentShader: verticalShader,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  })
  const quad = new Mesh(new PlaneGeometry(2, 2), material)
  quad.frustumCulled = false
  const quadScene = new Scene()
  quadScene.add(quad)
  const quadCamera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)

  /**
   * 외곽선을 두른 것. 화면 상자를 잴 때 쓴다(비어 있으면 그리지 않는다). 설비는 덩어리 형상을 나눠 쓰는 마스크라 형상의 상자가 덩어리
   * 전체다 — 그 설비의 상자(Part.box, 끌면 따라간다)를 같이 받는다.
   */
  let objects: { object: Object3D; box?: Box3 }[] = []
  let flash: { t0: number | null } | null = null
  /** 빛이 퍼진 횟수(e2e). */
  let flashes = 0
  let key = ''
  const size = new Vector2()
  const savedClear = new Color()
  const box = new Box3()
  const corner = new Vector3()

  /** 화면에서 objects 가 차지하는 사각형(드로잉 버퍼 픽셀, 아래 왼쪽 원점). 화면 밖이면 null. */
  function screenRect(camera: Camera, pad: number): { x: number; y: number; w: number; h: number } | null {
    box.makeEmpty()
    for (const o of objects) {
      if (o.box) box.union(o.box)
      else box.expandByObject(o.object)
    }
    if (box.isEmpty()) return null
    let x0 = Infinity
    let y0 = Infinity
    let x1 = -Infinity
    let y1 = -Infinity
    for (let i = 0; i < 8; i++) {
      corner.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z).applyMatrix4(camera.matrixWorldInverse)
      // 카메라 뒤로 넘어간 꼭짓점이 있으면 투영이 뒤집힌다. 그때는 화면 전체를 칠한다(가위질만 못 할 뿐 결과는 같다).
      if (corner.z > -0.01) return { x: 0, y: 0, w: size.x, h: size.y }
      corner.applyMatrix4(camera.projectionMatrix)
      x0 = Math.min(x0, corner.x)
      x1 = Math.max(x1, corner.x)
      y0 = Math.min(y0, corner.y)
      y1 = Math.max(y1, corner.y)
    }
    const px = (v: number, n: number) => ((v + 1) / 2) * n
    const left = Math.max(0, Math.floor(px(x0, size.x) - pad))
    const bottom = Math.max(0, Math.floor(px(y0, size.y) - pad))
    const right = Math.min(size.x, Math.ceil(px(x1, size.x) + pad))
    const top = Math.min(size.y, Math.ceil(px(y1, size.y) + pad))
    return right > left && top > bottom ? { x: left, y: bottom, w: right - left, h: top - bottom } : null
  }

  return {
    /**
     * 외곽선을 두를 것을 정한다. 각 물체(와 그 자식)는 이 외곽선의 층(`layer`)에 올라가 있어야 한다(부르는 쪽이 올린다).
     * `id` 가 바뀌면(다른 것을 골랐으면) 빛이 한 번 퍼졌다 준다. 같은 것을 다시 그리면(색·형상만 바뀜) 그러지 않는다.
     */
    set(next: { object: Object3D; box?: Box3 }[], id: string) {
      objects = next
      if (id && id !== key && style.flash !== null && !still()) {
        flash = { t0: null }
        flashes++
      }
      if (!id) flash = null
      key = id
    },
    /** 테마. 강조색이 라이트·다크에서 다르다. */
    setDark(on: boolean) {
      ;(material.uniforms.color.value as Color).setHex(on ? style.colors.dark : style.colors.light)
    },
    /** 매 프레임. 빛이 줄어드는 중이면 참(그동안 다시 그린다). */
    step(now: number): boolean {
      if (!flash) {
        material.uniforms.glow.value = GLOW_PX
        return false
      }
      if (flash.t0 === null) flash.t0 = now
      const k = Math.min(1, (now - flash.t0) / FLASH_MS)
      const from = style.flash ?? GLOW_PX
      material.uniforms.glow.value = from + (GLOW_PX - from) * easeOut(k)
      if (k === 1) flash = null
      return true
    },
    /** 장면을 그린 바로 뒤에 부른다. 그린 화면 위에 외곽선만 얹는다. */
    render(scene: Scene, camera: Camera) {
      if (!objects.length) return
      renderer.getDrawingBufferSize(size)
      if (target.width !== size.x || target.height !== size.y) target.setSize(size.x, size.y)
      const ratio = renderer.getPixelRatio()
      const glow = material.uniforms.glow.value as number
      const rect = screenRect(camera, (glow + 2) * ratio)
      if (!rect) return
      const prev = {
        target: renderer.getRenderTarget(),
        alpha: renderer.getClearAlpha(),
        autoClear: renderer.autoClear,
        layers: camera.layers.mask,
        override: scene.overrideMaterial,
        background: scene.background,
      }
      renderer.getClearColor(savedClear)
      renderer.setRenderTarget(target)
      renderer.setClearColor(0x000000, 0)
      renderer.clear(true, false, false)
      target.scissor.set(rect.x, rect.y, rect.w, rect.h)
      target.scissorTest = true
      camera.layers.set(layer)
      scene.overrideMaterial = maskMaterial
      scene.background = null
      renderer.render(scene, camera)
      target.scissorTest = false
      camera.layers.mask = prev.layers
      scene.overrideMaterial = prev.override
      scene.background = prev.background
      renderer.setRenderTarget(prev.target)
      renderer.setClearColor(savedClear, prev.alpha)

      const radius = Math.min(glow * ratio, MAX_RADIUS)
      ;(material.uniforms.texel.value as Vector2).set(1 / size.x, 1 / size.y)
      ;(horizontal.uniforms.texel.value as Vector2).set(1 / size.x, 1 / size.y)
      horizontal.uniforms.radius.value = radius
      material.uniforms.line.value = LINE_PX * ratio
      material.uniforms.glow.value = radius
      // 가로 단계는 같은 크기의 타깃에, 같은 가위질로 그린다.
      if (rows.width !== size.x || rows.height !== size.y) rows.setSize(size.x, size.y)
      quad.material = horizontal
      renderer.setRenderTarget(rows)
      // 세로 단계가 위아래로 반경만큼 더 읽는다. 그 줄까지 새로 써야 지난 프레임 값이 남지 않는다.
      const y0 = Math.max(0, rect.y - MAX_RADIUS)
      rows.scissor.set(rect.x, y0, rect.w, Math.min(size.y, rect.y + rect.h + MAX_RADIUS) - y0)
      rows.scissorTest = true
      renderer.render(quadScene, quadCamera)
      rows.scissorTest = false
      renderer.setRenderTarget(prev.target)
      quad.material = material
      // setScissor 는 CSS 픽셀을 받는다(three.js 가 픽셀비를 곱한다).
      renderer.setScissor(rect.x / ratio, rect.y / ratio, rect.w / ratio, rect.h / ratio)
      renderer.setScissorTest(true)
      renderer.autoClear = false
      renderer.render(quadScene, quadCamera)
      renderer.autoClear = prev.autoClear
      renderer.setScissorTest(false)
      material.uniforms.glow.value = glow
    },
    /** e2e 가 본다: 외곽선을 두른 수 · 빛이 퍼지는 중인가 · 퍼진 횟수 · 무엇을 골랐나. */
    state: () => ({ objects: objects.length, flashing: !!flash, flashes, key }),
    dispose() {
      target.dispose()
      rows.dispose()
      horizontal.dispose()
      maskMaterial.dispose()
      material.dispose()
      quad.geometry.dispose()
    },
  }
}
