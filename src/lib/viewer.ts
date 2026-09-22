// 임포트 결과를 3D 로 띄운다. 임포트가 맞았는지 눈으로 확인하는 것이 이 화면의 일이다.
//
// 표로는 안 잡히는 실패가 있다. 배치 사슬을 잘못 타면 방이 전부 원점에 겹쳐 쌓이는데,
// 개수도 넓이도 그대로라서 숫자만 봐서는 멀쩡해 보인다. 3D 로 띄우면 즉시 보인다.

import {
  AmbientLight,
  Box3,
  BoxGeometry,
  MeshBasicMaterial,
  DirectionalLight,
  DoubleSide,
  ExtrudeGeometry,
  Group,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  Scene,
  Shape,
  Vector3,
  WebGLRenderer,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { Model, Vec2 } from './model'

/** 층을 구분하는 색. 층 수만큼 순환한다. */
const STOREY_COLORS = [0x5ac8fa, 0xffd166, 0x9b8cff, 0x6fcf97, 0xff8a65]

/**
 * 공간 하나를 얇은 판으로 세운다.
 *
 * 벽 높이를 모르므로 두께만 주고 세우지 않는다. BIM 에서 층고를 읽어 오는 것은
 * 이 PoC 범위 밖이고, 평면이 맞는지 보는 데는 판이면 충분하다.
 */
export function spaceMesh(footprint: readonly Vec2[], color: number): Mesh | null {
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
    new MeshLambertMaterial({ color, transparent: true, opacity: 0.75, side: DoubleSide }),
  )
}

/**
 * 설비 한 대를 작은 상자로 찍는다.
 *
 * 좌표가 맞는지 보는 것이 목적이라 모양은 중요하지 않다. 천장 설비가 천장 높이에 뜨고
 * 기계실 설비가 바닥 가까이 있는 게 보이면 z 를 제대로 읽은 것이다.
 */
export function equipmentMarker(position: readonly [number, number, number]): Mesh {
  const mesh = new Mesh(new BoxGeometry(0.4, 0.4, 0.4), new MeshBasicMaterial({ color: 0xff5252 }))
  // IFC 는 z 가 높이지만 three 는 y 가 높이다. 여기서 축을 바꾼다.
  mesh.position.set(position[0], position[2], position[1])
  return mesh
}

export type Viewer = {
  setModel(model: Model): void
  dispose(): void
}

export function createViewer(canvas: HTMLCanvasElement): Viewer {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  const scene = new Scene()
  const camera = new PerspectiveCamera(50, 1, 0.1, 5000)
  const controls = new OrbitControls(camera, canvas)
  controls.enableDamping = true

  scene.add(new AmbientLight(0xffffff, 1.6))
  const sun = new DirectionalLight(0xffffff, 1.2)
  sun.position.set(20, 40, 20)
  scene.add(sun)

  let content = new Group()
  scene.add(content)

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

  return {
    setModel(model) {
      // 이전 모델의 지오메트리를 놓아 준다. 파일을 여러 번 열면 GPU 메모리가 쌓인다.
      content.traverse((o) => {
        if (o instanceof Mesh) {
          o.geometry.dispose()
          ;(o.material as { dispose(): void }).dispose()
        }
      })
      scene.remove(content)
      content = new Group()

      model.storeys.forEach((storey, i) => {
        const color = STOREY_COLORS[i % STOREY_COLORS.length]
        for (const space of storey.spaces) {
          const mesh = spaceMesh(space.footprint, color)
          if (!mesh) continue
          mesh.position.y = storey.elevation
          content.add(mesh)
        }
        // 좌표가 없는 설비는 찍지 않는다. 원점에 찍으면 거기 있는 것처럼 보인다.
        for (const equipment of storey.equipment) {
          if (equipment.position) content.add(equipmentMarker(equipment.position))
        }
      })
      scene.add(content)

      // 건물이 화면에 꽉 차게 카메라를 놓는다. 원점 근처에 고정해 두면 실제 좌표가 먼
      // 모델이 화면 밖으로 나가서, 임포트가 잘 됐는데도 빈 화면처럼 보인다.
      const box = new Box3().setFromObject(content)
      if (box.isEmpty()) return

      const size = box.getSize(new Vector3())
      const center = box.getCenter(new Vector3())
      const span = Math.max(size.x, size.z, 1)

      controls.target.copy(center)
      camera.position.set(center.x + span, center.y + span * 0.9, center.z + span)
      camera.near = span / 100
      camera.far = span * 100
      camera.updateProjectionMatrix()
      controls.update()
    },
    dispose() {
      running = false
      controls.dispose()
      renderer.dispose()
    },
  }
}
