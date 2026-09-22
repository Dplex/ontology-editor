// 임포트 결과를 3D 로 띄운다. 임포트가 맞았는지 눈으로 확인하는 것이 이 화면의 일이다.
//
// 표로는 안 잡히는 실패가 있다. 배치 사슬을 잘못 타면 방이 전부 원점에 겹쳐 쌓이는데,
// 개수도 넓이도 그대로라서 숫자만 봐서는 멀쩡해 보인다. 3D 로 띄우면 즉시 보인다.
//
// 설비는 상자 점이 아니라 IFC 의 실제 형상으로 그린다. 배관·덕트는 점으로 찍으면 계통이
// 어디로 지나가는지가 사라져서, 연결을 추정한 것이 맞는지 눈으로 확인할 수가 없다.

import {
  AmbientLight,
  Box3,
  Sphere,
  BoxGeometry,
  BufferAttribute,
  BufferGeometry,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Shape,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Model, Vec2 } from './model'
import type { MeshMap } from './ifc/import'

/**
 * 층을 구분하는 색. 층 수만큼 순환한다.
 *
 * 파랑에서 시작해 색상환을 도는 중채도 계열이다. 흙빛 계열을 써 봤더니 밝은 배경 위에서
 * 낡아 보였고, 형광색은 반대로 튀기만 한다. 채도는 중간, 명도는 비슷하게 맞춰서 어느
 * 층이 위인지가 색이 아니라 높이로 읽히게 한다.
 */
const STOREY_COLORS = [0x6f9bf5, 0x4fc3a1, 0xb08ef0, 0xf0a94e, 0xef7d7d]

/**
 * 계통을 구분하는 색. 계통 수만큼 순환한다.
 *
 * 층 색과 같은 성질로 고른다 — 채도는 중간, 명도는 비슷하게. 한 건물에 계통이 스무 개쯤
 * 되는 일이 흔해서(Duplex MEP 가 20개다) 색만으로는 다 구분되지 않는다. 그래서 범례에서
 * 계통을 짚는 쪽을 주된 길로 두고, 색은 "여기까지가 한 계통" 을 보는 보조로 쓴다.
 */
const SYSTEM_COLORS = [
  0x2f6fed, 0x1f9d7a, 0x9b59d0, 0xe0803a, 0xd1495b, 0x2aa8c4, 0x7a8b3f, 0xc2467f, 0x4a5bd4, 0x3f8f4a,
]

/** 계통에 색을 배정한다. 범례와 3D 가 같은 값을 봐야 해서 한 곳에서 만든다. */
export function systemColors(model: Model): Map<string, number> {
  return new Map(model.systems.map((s, i) => [s.id, SYSTEM_COLORS[i % SYSTEM_COLORS.length]]))
}

/** 계통이 없는 설비. 색을 안 주면 안 보이므로 중립 회색으로 둔다. */
const NO_SYSTEM = 0x98a1ab

/**
 * 선택과 연결을 나타내는 색.
 *
 * 상류·하류·방향 모름을 서로 다른 색으로 둔다. 방향 모름을 하류와 같은 색으로 두면,
 * 추정한 연결이 BIM 이 말해 준 흐름처럼 보인다.
 */
const PICK_COLORS = {
  selected: 0x1b48b5,
  upstream: 0xe0803a,
  downstream: 0x1f9d7a,
  linked: 0x9b59d0,
  dimmed: 0xc8cdd3,
}

export type Highlight = {
  selected: string | null
  upstream: Set<string>
  downstream: Set<string>
  linked: Set<string>
  /**
   * 참이면 강조된 것에 제 계통 색을 그대로 둔다. 계통 하나만 켤 때 쓴다 — 범례의 색과
   * 3D 의 색이 달라지면, 켠 계통이 범례에서 짚은 그 계통인지 알 수 없다.
   */
  keepColor?: boolean
}

/**
 * 공간 하나를 얇은 판으로 세운다.
 *
 * 벽 높이를 모르므로 두께만 주고 세우지 않는다. BIM 에서 층고를 읽어 오는 것은
 * 이 PoC 범위 밖이고, 평면이 맞는지 보는 데는 판이면 충분하다.
 */
export function spaceMesh(footprint: readonly Vec2[], color: number, opacity = 0.8): Mesh | null {
  if (footprint.length < 3) return null

  const shape = new Shape()
  shape.moveTo(footprint[0][0], footprint[0][1])
  for (const p of footprint.slice(1)) shape.lineTo(p[0], p[1])
  shape.closePath()

  const geometry = new ExtrudeGeometry(shape, { depth: 0.1, bevelEnabled: false })
  // Shape 는 XY 평면에 그려진다. 건물 평면이 XZ 가 되도록 눕힌다.
  geometry.rotateX(-Math.PI / 2)

  return new Mesh(
    geometry,
    new MeshLambertMaterial({ color, transparent: true, opacity, side: DoubleSide }),
  )
}

/**
 * IFC 세계 좌표를 three 좌표로 옮긴다.
 *
 * IFC 는 z 가 높이고 three 는 y 가 높이다. **평면 y 의 부호가 뒤집힌다** — 공간 판은
 * `rotateX(-90°)` 로 눕히면서 (x, y) 가 (x, -y) 로 가고, web-ifc 가 주는 메시도 같은
 * 변환을 이미 거쳐서 온다. 설비 점만 부호를 그대로 두면 설비가 건물을 가로질러 거울처럼
 * 뒤집힌 자리에 찍힌다. 그래도 개수와 좌표값은 멀쩡해서 표로는 잡히지 않는다.
 */
export function toScene(position: readonly [number, number, number]): [number, number, number] {
  return [position[0], position[2], -position[1]]
}

/**
 * 설비 한 대를 작은 상자로 찍는다. **형상이 없는 설비의 대비책이다.**
 *
 * 좌표는 있는데 IFC 에 형상이 없는 설비가 실제로 있다. 그런 설비까지 안 보이면 "BIM 에
 * 없는 것" 과 "형상이 없는 것" 이 화면에서 같아진다.
 */
export function equipmentMarker(position: readonly [number, number, number], color: number): Mesh {
  const mesh = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial({ color }))
  mesh.position.set(...toScene(position))
  return mesh
}

export type Viewer = {
  setModel(model: Model, meshes?: MeshMap): void
  /** 선택과 상류·하류를 색으로 칠한다. null 이면 전부 원래 색으로 되돌린다. */
  setHighlight(highlight: Highlight | null): void
  /** 3D 에서 설비를 고르면 부른다. 빈 곳을 누르면 null 이다. */
  onPick(handler: (id: string | null) => void): void
  /** 그 설비가 화면 가운데 오도록 카메라를 돌린다. */
  focus(id: string): void
  /** 주어진 설비들이 화면에 꽉 차게 카메라를 맞춘다. 연결망만 보고 싶을 때 쓴다. */
  frame(ids: Iterable<string>): void
  dispose(): void
}

export function createViewer(canvas: HTMLCanvasElement): Viewer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true

  // 밝은 배경 위에서는 빛을 덜 준다. 그러지 않으면 면이 하얗게 날아가 경계가 사라진다.
  scene.add(new AmbientLight(0xffffff, 1.25))
  const sun = new DirectionalLight(0xffffff, 0.9)
  sun.position.set(20, 40, 20)
  scene.add(sun)

  let content = new Group()
  scene.add(content)

  /** 설비 id → 그 설비를 그린 메시들. 강조할 때 색을 바꾸려고 들고 있는다. */
  let byEquipment = new Map<string, { mesh: Mesh; color: number }[]>()
  let pickHandler: (id: string | null) => void = () => {}

  const raycaster = new Raycaster()
  const pointer = new Vector2()
  let pressedAt: { x: number; y: number } | null = null

  canvas.addEventListener('pointerdown', (e) => {
    pressedAt = { x: e.clientX, y: e.clientY }
  })
  canvas.addEventListener('pointerup', (e) => {
    // 시점을 돌린 것과 고른 것을 가른다. 끌었으면 고르기가 아니다.
    if (!pressedAt) return
    const dragged = Math.hypot(e.clientX - pressedAt.x, e.clientY - pressedAt.y) > 4
    pressedAt = null
    if (dragged) return

    const rect = canvas.getBoundingClientRect()
    pointer.x = ((e.clientX - rect.left) / rect.width) * 2 - 1
    pointer.y = -((e.clientY - rect.top) / rect.height) * 2 + 1
    raycaster.setFromCamera(pointer, camera)

    const targets = [...byEquipment.values()].flatMap((list) => list.map((m) => m.mesh))
    const hit = raycaster.intersectObjects(targets, false)[0]
    pickHandler((hit?.object.userData.equipmentId as string) ?? null)
  })

  function resize() {
    const { clientWidth: w, clientHeight: h } = canvas
    if (w === 0 || h === 0) return
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
  }

  let running = true
  function tick() {
    if (!running) return
    resize()
    controls.update()
    renderer.render(scene, camera)
    requestAnimationFrame(tick)
  }
  tick()

  /**
   * 상자가 화면에 꽉 차도록 카메라를 놓는다.
   *
   * 긴 변 하나만 보고 거리를 잡으면 안 된다. 세로 시야각으로만 계산하면 가로로 넓적한 건물이
   * 화면 밖으로 삐져나가고, 비스듬히 보는 각도에서는 더 커 보인다. 외접구 반지름을 가로·세로
   * 시야각 중 **좁은 쪽**에 맞춘다.
   */
  function fit(box: Box3) {
    const sphere = box.getBoundingSphere(new Sphere())
    if (sphere.radius <= 0) return

    const vFov = (camera.fov * Math.PI) / 180
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * (camera.aspect || 1.6))
    const distance = (sphere.radius / Math.sin(Math.min(vFov, hFov) / 2)) * 1.1

    controls.target.copy(sphere.center)
    camera.position.copy(sphere.center).add(new Vector3(1, 0.65, 1).normalize().multiplyScalar(distance))
    camera.near = Math.max(distance / 1000, 0.01)
    camera.far = distance * 10
    camera.updateProjectionMatrix()
    controls.update()
  }

  /** 요소 하나의 메시. 좌표는 이미 three 세계 좌표(y 가 높이)라 여기서 돌리지 않는다. */
  function elementMesh(data: { positions: Float32Array; normals: Float32Array; indices: Uint32Array }, color: number) {
    const geometry = new BufferGeometry()
    geometry.setAttribute('position', new BufferAttribute(data.positions, 3))
    geometry.setAttribute('normal', new BufferAttribute(data.normals, 3))
    geometry.setIndex(new BufferAttribute(data.indices, 1))
    return new Mesh(geometry, new MeshLambertMaterial({ color, side: DoubleSide }))
  }

  return {
    setModel(model, meshes) {
      // 이전 모델의 지오메트리를 놓아 준다. 파일을 여러 번 열면 GPU 메모리가 쌓인다.
      content.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose()
          ;(o.material as { dispose(): void }).dispose()
        }
      })
      scene.remove(content)
      content = new Group()
      byEquipment = new Map()

      const colorOf = systemColors(model)
      // 배관이 방 안을 지나므로 판을 옅게 깐다. 진하면 배관이 판에 묻힌다.
      const slabOpacity = meshes && meshes.size > 0 ? 0.25 : 0.8

      model.storeys.forEach((storey, i) => {
        const color = STOREY_COLORS[i % STOREY_COLORS.length]
        for (const space of storey.spaces) {
          const mesh = spaceMesh(space.footprint, color, slabOpacity)
          if (!mesh) continue
          mesh.position.y = storey.elevation
          content.add(mesh)
        }

        for (const equipment of storey.equipment) {
          const color = equipment.systemId ? (colorOf.get(equipment.systemId) ?? NO_SYSTEM) : NO_SYSTEM
          const data = meshes?.get(equipment.id)
          const drawn: Mesh[] = []

          if (data) drawn.push(elementMesh(data, color))
          // 좌표가 없는 설비는 찍지 않는다. 원점에 찍으면 거기 있는 것처럼 보인다.
          else if (equipment.position) drawn.push(equipmentMarker(equipment.position, color))

          for (const mesh of drawn) {
            mesh.userData.equipmentId = equipment.id
            content.add(mesh)
          }
          if (drawn.length > 0) byEquipment.set(equipment.id, drawn.map((mesh) => ({ mesh, color })))
        }
      })
      scene.add(content)

      // 건물이 화면에 꽉 차게 카메라를 놓는다. 원점 근처에 고정해 두면 실제 좌표가 먼
      // 모델이 화면 밖으로 나가서, 임포트가 잘 됐는데도 빈 화면처럼 보인다.
      const box = new Box3().setFromObject(content)
      if (box.isEmpty()) return

      fit(box)
    },

    setHighlight(highlight) {
      for (const [id, parts] of byEquipment) {
        for (const { mesh, color } of parts) {
          const material = mesh.material as MeshLambertMaterial & { opacity: number; transparent: boolean }
          let next = color
          let faded = false

          if (highlight) {
            if (id === highlight.selected) next = PICK_COLORS.selected
            else if (highlight.upstream.has(id)) next = PICK_COLORS.upstream
            else if (highlight.downstream.has(id)) next = PICK_COLORS.downstream
            else if (highlight.linked.has(id)) next = highlight.keepColor ? color : PICK_COLORS.linked
            else {
              // 고른 것과 상관없는 설비는 지운다. 지우지 않으면 연결망이 숲에 묻힌다.
              next = PICK_COLORS.dimmed
              faded = true
            }
          }
          material.color.setHex(next)
          material.transparent = faded
          // 아주 옅게 남긴다. 아예 지우면 연결망이 건물 어디쯤인지 알 수 없고, 진하면
          // 2천 개짜리 모델에서 가는 배관 한 줄이 그대로 묻힌다.
          material.opacity = faded ? 0.08 : 1
          material.depthWrite = !faded
        }
      }
    },

    onPick(handler) {
      pickHandler = handler
    },

    focus(id) {
      const parts = byEquipment.get(id)
      if (!parts || parts.length === 0) return
      const box = new Box3()
      for (const { mesh } of parts) box.expandByObject(mesh)
      if (box.isEmpty()) return

      const center = box.getCenter(new Vector3())
      // 거리는 그대로 두고 바라보는 곳만 옮긴다. 확대까지 하면 어디를 보고 있었는지 잃는다.
      const offset = camera.position.clone().sub(controls.target)
      controls.target.copy(center)
      camera.position.copy(center).add(offset)
      controls.update()
    },

    frame(ids) {
      const box = new Box3()
      for (const id of ids) {
        for (const { mesh } of byEquipment.get(id) ?? []) box.expandByObject(mesh)
      }
      if (box.isEmpty()) return
      fit(box)
    },

    dispose() {
      running = false
      controls.dispose()
      renderer.dispose()
    },
  }
}
