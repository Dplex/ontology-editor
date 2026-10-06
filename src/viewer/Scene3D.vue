<script setup lang="ts">
// 내보낸 GLB·OBJ 를 그대로 그린다. 에디터의 3D 화면(lib/viewer.ts)을 쓰지 않는다 — 그건 모델을 그리고, 여기는 **파일**을 그린다.
// 파일에 없는 것(색·층 묶음·extras)은 파일 탓으로 보여야 하므로, OBJ 처럼 색이 없는 파일만 GeoJSON 의 종류로 칠한다.
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import {
  AmbientLight,
  Box3,
  Color,
  DirectionalLight,
  type Material,
  type Mesh,
  MeshStandardMaterial,
  type Object3D,
  PerspectiveCamera,
  Raycaster,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  DoubleSide,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'

const props = defineProps<{
  root: Object3D
  /** 파일에 색이 없으면(OBJ) 이 종류로 칠한다. */
  kindOf: (id: string) => string | null
  colored: boolean
  selectedId: string | null
  /** 보일 id. null 이면 전부. */
  visible: Set<string> | null
}>()
const emit = defineEmits<{ select: [id: string] }>()

const host = ref<HTMLDivElement | null>(null)
const baseId = (name: string) => name.replace(/#\d+$/, '')
const KIND_COLOR: Record<string, number> = { space: 0x8fb3e8, wall: 0xb8bec7, door: 0xa16207, window: 0x7dd3fc, equipment: 0x0f766e }
const highlight = new MeshStandardMaterial({ color: 0xd1372b, emissive: 0x5a0d08, side: DoubleSide })

let renderer: WebGLRenderer | null = null
let camera: PerspectiveCamera | null = null
let controls: OrbitControls | null = null
let observer: ResizeObserver | null = null
const scene = new Scene()
const original = new Map<Mesh, Material | Material[]>()
let meshes: Mesh[] = []

function render() {
  if (renderer && camera) renderer.render(scene, camera)
}

function paint() {
  for (const m of meshes) {
    const id = baseId(m.name)
    m.visible = !props.visible || props.visible.has(id)
    m.material = id === props.selectedId ? highlight : original.get(m)!
  }
  render()
}

function fit() {
  if (!camera || !controls) return
  const box = new Box3()
  for (const m of meshes) if (m.visible) box.expandByObject(m)
  if (box.isEmpty()) return
  const center = box.getCenter(new Vector3())
  const size = box.getSize(new Vector3()).length() || 1
  camera.near = size / 1000
  camera.far = size * 20
  camera.position.copy(center).add(new Vector3(0.6, 0.7, 0.9).multiplyScalar(size * 0.8))
  camera.updateProjectionMatrix()
  controls.target.copy(center)
  controls.update()
  render()
}

function attach(root: Object3D) {
  scene.clear()
  original.clear()
  scene.background = new Color(getComputedStyle(document.documentElement).getPropertyValue('--surface-soft').trim() || '#f1f3f6')
  scene.add(new AmbientLight(0xffffff, 1.4))
  const sun = new DirectionalLight(0xffffff, 1.8)
  sun.position.set(1, 2, 1.5)
  scene.add(sun)
  scene.add(root)
  meshes = []
  root.traverse((o) => {
    const m = o as Mesh
    if (!m.isMesh) return
    meshes.push(m)
    if (!props.colored) {
      const kind = props.kindOf(baseId(m.name))
      m.material = new MeshStandardMaterial({
        color: KIND_COLOR[kind ?? ''] ?? 0x98a1ab,
        side: DoubleSide,
        transparent: kind === 'space',
        opacity: kind === 'space' ? 0.5 : 1,
      })
    }
    original.set(m, m.material)
  })
  paint()
  fit()
}

// 끌기와 누르기를 가른다. 시점을 돌리려고 끈 것을 고르기로 읽으면 놓을 때마다 선택이 바뀐다.
let down: { x: number; y: number } | null = null
function onDown(e: PointerEvent) {
  down = { x: e.clientX, y: e.clientY }
}
function onUp(e: PointerEvent) {
  if (!down || !renderer || !camera) return
  const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y)
  down = null
  if (moved > 4) return
  const rect = renderer.domElement.getBoundingClientRect()
  const ray = new Raycaster()
  ray.setFromCamera(new Vector2(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1), camera)
  const hit = ray.intersectObjects(meshes.filter((m) => m.visible), false)[0]
  if (hit) emit('select', baseId(hit.object.name))
}

onMounted(() => {
  const el = host.value!
  renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true })
  renderer.setPixelRatio(window.devicePixelRatio)
  el.appendChild(renderer.domElement)
  camera = new PerspectiveCamera(45, 1, 0.1, 1000)
  controls = new OrbitControls(camera, renderer.domElement)
  controls.addEventListener('change', render)
  renderer.domElement.addEventListener('pointerdown', onDown)
  renderer.domElement.addEventListener('pointerup', onUp)
  observer = new ResizeObserver(() => {
    const w = el.clientWidth
    const h = el.clientHeight
    renderer!.setSize(w, h)
    camera!.aspect = w / Math.max(h, 1)
    camera!.updateProjectionMatrix()
    render()
  })
  observer.observe(el)
  attach(props.root)
})

watch(() => props.root, (r) => attach(r))
watch(() => [props.selectedId, props.visible], paint)
watch(() => props.visible, fit)

onBeforeUnmount(() => {
  observer?.disconnect()
  controls?.dispose()
  scene.remove(props.root)
  renderer?.dispose()
})

defineExpose({ fit })
</script>

<template>
  <div ref="host" class="scene3d" role="img" aria-label="3D 형상"></div>
</template>

<style scoped>
.scene3d {
  width: 100%;
  height: 34rem;
  margin-top: 0.75rem;
  border-radius: var(--radius-sm);
  overflow: hidden;
}
</style>
