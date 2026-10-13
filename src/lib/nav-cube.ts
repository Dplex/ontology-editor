// 3D 오른쪽 위의 방향 큐브. 메인 3D 와 따로 작은 캔버스에 그려서, 큐브를 누르고 끄는 것이 메인 3D 의 고르기·끌기와 섞이지 않는다.
// 큐브는 메인 카메라와 같은 방향에서 본 모습이다(메인 시점이 돌면 같이 돈다). 면을 누르면 그 면 쪽에서 보는 시점으로, 모서리는
// 두 면 사이 45°, 꼭짓점은 세 면 사이로 날아간다. 큐브를 끌면 메인 시점이 대상 둘레로 돈다.
// 축은 장면 좌표다 — x 가 IFC x, y 가 위, z 가 IFC −y(viewer.ts 의 toScene). 면 글자는 모델 축 기준의 위·아래·앞·뒤·좌·우이고
// 진북(TrueNorth)이 아니다. 앞은 IFC −y 쪽에서 +y 를 보는 면이다(평면도에서 아래쪽에 서서 보는 방향).
import {
  BoxGeometry,
  CanvasTexture,
  EdgesGeometry,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  PerspectiveCamera,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three'

/** BoxGeometry 의 면 순서(+x, −x, +y, −y, +z, −z)와 같은 순서의 글자. */
export const CUBE_FACES = ['우', '좌', '위', '아래', '앞', '뒤'] as const
/** 면 가장자리에서 이만큼(큐브 한 변 1 기준) 안쪽까지는 모서리·꼭짓점으로 친다. */
const EDGE = 0.2
/** 누르기로 칠 끌기 거리(px). 이보다 많이 움직이면 시점 돌리기다. */
const CLICK_PX = 4

/** 큐브 위 한 점(큐브 좌표, 한 변 1)이 가리키는 시점 방향. 면이면 축 하나, 모서리면 둘, 꼭짓점이면 셋이 0 이 아니다. */
export function cubeDirection(p: readonly [number, number, number]): [number, number, number] {
  const limit = 0.5 - EDGE
  const d: [number, number, number] = [0, 0, 0]
  p.forEach((v, i) => (d[i] = Math.abs(v) > limit ? Math.sign(v) : 0))
  // 면 한가운데를 누르면 그 면의 축 하나다(두 축이 경계 안이면 가장 바깥 축).
  if (!d[0] && !d[1] && !d[2]) {
    const i = [0, 1, 2].reduce((a, b) => (Math.abs(p[b]) > Math.abs(p[a]) ? b : a))
    d[i] = Math.sign(p[i]) || 1
  }
  return d
}

export type NavCube = {
  /** 메인 카메라가 대상에서 떨어진 방향(장면 좌표)과 위쪽. 그때의 큐브를 그린다. */
  render(viewDir: Vector3, up: Vector3): void
  dispose(): void
}

export function createNavCube(
  canvas: HTMLCanvasElement,
  handlers: { pick(dir: [number, number, number]): void; orbit(dx: number, dy: number): void; dark(): boolean },
): NavCube {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true })
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2))
  const scene = new Scene()
  const camera = new PerspectiveCamera(30, 1, 0.1, 20)
  const materials = CUBE_FACES.map((label) => new MeshBasicMaterial({ map: faceTexture(label, handlers.dark()) }))
  const cube = new Mesh(new BoxGeometry(1, 1, 1), materials)
  scene.add(cube)
  const edges = new LineSegments(new EdgesGeometry(cube.geometry), new LineBasicMaterial({ color: 0x8a94a3 }))
  scene.add(edges)
  let dark = handlers.dark()
  let last: { dir: Vector3; up: Vector3 } | null = null

  function draw() {
    if (!last) return
    const { clientWidth: w, clientHeight: h } = canvas
    if (!w || !h) return
    renderer.setSize(w, h, false)
    camera.aspect = w / h
    camera.updateProjectionMatrix()
    // 테마가 바뀌면 글자 바탕을 다시 칠한다.
    if (dark !== handlers.dark()) {
      dark = handlers.dark()
      materials.forEach((m, i) => {
        m.map?.dispose()
        m.map = faceTexture(CUBE_FACES[i], dark)
        m.needsUpdate = true
      })
    }
    camera.position.copy(last.dir).multiplyScalar(3.4)
    camera.up.copy(last.up)
    camera.lookAt(0, 0, 0)
    renderer.render(scene, camera)
  }

  const ray = new Raycaster()
  const at = new Vector2()
  let down: { x: number; y: number; lastX: number; lastY: number; moved: boolean } | null = null
  function onDown(e: PointerEvent) {
    if (e.button !== 0) return
    canvas.setPointerCapture(e.pointerId)
    down = { x: e.clientX, y: e.clientY, lastX: e.clientX, lastY: e.clientY, moved: false }
    e.preventDefault()
  }
  function onMove(e: PointerEvent) {
    if (!down) {
      canvas.style.cursor = hit(e) ? 'pointer' : ''
      return
    }
    if (!down.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < CLICK_PX) return
    down.moved = true
    canvas.style.cursor = 'grabbing'
    handlers.orbit(e.clientX - down.lastX, e.clientY - down.lastY)
    down.lastX = e.clientX
    down.lastY = e.clientY
  }
  function onUp(e: PointerEvent) {
    const was = down
    down = null
    canvas.style.cursor = ''
    if (!was || was.moved) return
    const p = hit(e)
    if (p) handlers.pick(cubeDirection([p.x, p.y, p.z]))
  }
  function hit(e: PointerEvent): Vector3 | null {
    const r = canvas.getBoundingClientRect()
    at.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
    ray.setFromCamera(at, camera)
    return ray.intersectObject(cube)[0]?.point ?? null
  }
  canvas.addEventListener('pointerdown', onDown)
  canvas.addEventListener('pointermove', onMove)
  canvas.addEventListener('pointerup', onUp)
  canvas.addEventListener('pointercancel', onUp)

  return {
    render(viewDir, up) {
      last = { dir: viewDir.clone().normalize(), up: up.clone() }
      draw()
    },
    dispose() {
      canvas.removeEventListener('pointerdown', onDown)
      canvas.removeEventListener('pointermove', onMove)
      canvas.removeEventListener('pointerup', onUp)
      canvas.removeEventListener('pointercancel', onUp)
      for (const m of materials) {
        m.map?.dispose()
        m.dispose()
      }
      cube.geometry.dispose()
      edges.geometry.dispose()
      ;(edges.material as LineBasicMaterial).dispose()
      renderer.dispose()
    },
  }
}

function faceTexture(label: string, dark: boolean): CanvasTexture {
  const size = 128
  const c = document.createElement('canvas')
  c.width = c.height = size
  const g = c.getContext('2d')!
  g.fillStyle = dark ? '#2a313c' : '#f3f5f8'
  g.fillRect(0, 0, size, size)
  g.fillStyle = dark ? '#d6dbe3' : '#3c4654'
  g.font = `600 ${label.length > 1 ? 40 : 48}px system-ui, sans-serif`
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(label, size / 2, size / 2 + 2)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  return t
}
