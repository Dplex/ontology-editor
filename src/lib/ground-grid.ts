// --- 3D 바닥 아래의 작업대 격자 ---
//
// 건물 밑에 1m · 10m 두 겹의 격자를 깔고, 건물에서 멀어질수록 흐려지게 한다. 배경이 빈 면이면 건물이 허공에 뜬 것처럼 보이고,
// 확대·축소할 때 크기를 가늠할 기준이 없었다. 편집용 스냅 격자(OE-UI-07, setGrid)와는 따로다 — 그쪽은 편집하는 층 위의 선이고,
// 이것은 맨 아래 보이는 층 바닥 밑에 깔리는 배경이라 고르기·스냅에 끼지 않는다.
// ArtCraft(storytold/artcraft)의 InfiniteGridHelper 에서 가져왔다(reference.md). 선 굵기는 화면 픽셀로 잡아(fwidth) 멀리서도 1px 안팎이고,
// 칸이 몇 픽셀보다 작아지면 그 겹은 스스로 사라진다(멀리서 1m 격자가 회색 면으로 뭉치지 않는다).
// 판 하나에 셰이더 하나라 그리기 호출이 하나 더 늘 뿐이다.

import { Box3, Color, DoubleSide, Mesh, PlaneGeometry, ShaderMaterial, Vector3 } from 'three'

const COLORS = { light: { line: 0x1f2937, minor: 0.045, major: 0.11 }, dark: { line: 0xe5e7eb, minor: 0.04, major: 0.1 } }

const vertexShader = /* glsl */ `
  varying vec3 vWorld;
  void main() {
    vec4 w = modelMatrix * vec4(position, 1.0);
    vWorld = w.xyz;
    gl_Position = projectionMatrix * viewMatrix * w;
  }
`
const fragmentShader = /* glsl */ `
  uniform vec3 color;
  uniform float minorAlpha;
  uniform float majorAlpha;
  uniform vec2 center;
  uniform float radius;
  varying vec3 vWorld;
  // 칸 크기 size 의 격자선 세기(0..1). 선은 화면에서 1px 안팎이고, 칸이 화면에서 6px 보다 작으면 흐려져 사라진다.
  float grid(float size) {
    vec2 p = vWorld.xz / size;
    vec2 w = fwidth(p);
    vec2 g = abs(fract(p - 0.5) - 0.5) / w;
    float line = 1.0 - min(min(g.x, g.y), 1.0);
    float cell = 1.0 / max(w.x, w.y);
    return line * smoothstep(3.0, 6.0, cell);
  }
  void main() {
    float d = length(vWorld.xz - center) / radius;
    float fade = 1.0 - smoothstep(0.35, 1.0, d);
    float a = max(grid(1.0) * minorAlpha, grid(10.0) * majorAlpha) * fade;
    if (a < 0.003) discard;
    gl_FragColor = vec4(color, a);
  }
`

export type GroundGrid = ReturnType<typeof createGroundGrid>

export function createGroundGrid() {
  const material = new ShaderMaterial({
    uniforms: {
      color: { value: new Color(COLORS.light.line) },
      minorAlpha: { value: COLORS.light.minor },
      majorAlpha: { value: COLORS.light.major },
      center: { value: [0, 0] },
      radius: { value: 60 },
    },
    vertexShader,
    fragmentShader,
    transparent: true,
    depthWrite: false,
    side: DoubleSide,
  })
  const mesh = new Mesh(new PlaneGeometry(1, 1), material)
  mesh.rotation.x = -Math.PI / 2
  // 판·벽보다 먼저 그린다. 깊이를 쓰지 않아 위의 반투명 물리존 판이 격자를 덮어도 판 색이 탁해지지 않는다.
  mesh.renderOrder = -1
  mesh.visible = false
  mesh.userData.groundGrid = true
  const size = new Vector3()
  const mid = new Vector3()
  return {
    mesh,
    /**
     * 보이는 것의 상자(장면 좌표)와 바닥 높이(맨 아래 보이는 층의 바닥, 장면 y)에 맞춰 깐다. 상자가 비면 숨긴다.
     * 판은 건물 큰 변의 여섯 배(최소 200m)이고, 흐려지는 반경은 큰 변의 1.6배(최소 30m)다.
     */
    place(box: Box3, floor: number) {
      if (box.isEmpty()) {
        mesh.visible = false
        return
      }
      box.getSize(size)
      box.getCenter(mid)
      const extent = Math.max(size.x, size.z, 10)
      const side = Math.max(extent * 6, 200)
      mesh.scale.set(side, side, 1)
      // 판(물리존 판 바닥 = 층 바닥)과 겹치지 않게 조금 내린다.
      mesh.position.set(mid.x, floor - 0.02, mid.z)
      material.uniforms.center.value = [mid.x, mid.z]
      material.uniforms.radius.value = Math.max(extent * 1.6, 30)
      mesh.visible = true
    },
    setDark(on: boolean) {
      const c = on ? COLORS.dark : COLORS.light
      ;(material.uniforms.color.value as Color).setHex(c.line)
      material.uniforms.minorAlpha.value = c.minor
      material.uniforms.majorAlpha.value = c.major
    },
    dispose() {
      mesh.geometry.dispose()
      material.dispose()
    },
  }
}
