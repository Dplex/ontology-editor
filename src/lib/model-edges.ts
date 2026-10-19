// --- 벽·가구의 모서리 선 ---
//
// 면이 꺾이는 모서리에 가는 선을 긋는다. 벽이 같은 회색 면끼리 이어 붙으면 어디서 꺾이고 어디가 문틀인지 그늘로만 읽어야 했다.
// 건축 모형처럼 모서리가 보이면 벽 두께·개구부·가구 모양이 한눈에 읽힌다.
// ArtCraft(storytold/artcraft)의 CustomOutlinePass(면 번호로 모서리를 찾는 후처리)에서 착안했다(reference.md). 후처리는 장면을 한 번 더
// 그려야 해서 성수 설비(정점 1천만 개)에는 쓰지 않고, 형상이 바뀔 때 한 번 모서리를 뽑아 선으로 둔다(EdgesGeometry). 벽·문·창·가구만이다 —
// 설비는 형상이 크고 계통 색으로 이미 갈린다.

import { EdgesGeometry, LineBasicMaterial, LineSegments, type BufferGeometry, type Mesh } from 'three'

/** 두 면의 각이 이보다 작으면 모서리로 보지 않는다(곡면을 이루는 잘게 나뉜 삼각형). */
const THRESHOLD_DEG = 25
const COLORS = { light: { color: 0x1f2937, opacity: 0.42 }, dark: { color: 0x0b0d10, opacity: 0.7 } }
let darkTheme = false

/** 모서리 선의 테마. 이후에 만드는 선과 `lines` 의 선을 바꾼다. */
export function setEdgeTheme(on: boolean, lines: Iterable<LineSegments>) {
  darkTheme = on
  const c = on ? COLORS.dark : COLORS.light
  for (const l of lines) {
    const m = l.material as LineBasicMaterial
    m.color.setHex(c.color)
    m.opacity = c.opacity
  }
}

/** 형상의 모서리 선. 메시의 자식으로 붙인다 — 보이기·층 숨기기·자리(오브젝트 끌기)를 메시를 따라간다. */
export function edgeLines(geometry: BufferGeometry): LineSegments {
  const c = darkTheme ? COLORS.dark : COLORS.light
  const lines = new LineSegments(new EdgesGeometry(geometry, THRESHOLD_DEG), new LineBasicMaterial({ color: c.color, transparent: true, opacity: c.opacity, depthWrite: false }))
  lines.userData.edges = true
  // 면과 같은 깊이라 선이 면에 묻혀 깜박인다. 면을 조금 뒤로 민다(polygonOffset) — 부르는 쪽 메시 재질에 offsetFaces 를 쓴다.
  lines.renderOrder = 1
  return lines
}

/** 메시 재질을 조금 뒤로 밀어 모서리 선이 면 위에 또렷이 보이게 한다. */
export function offsetFaces(mesh: Mesh) {
  for (const m of [mesh.material].flat()) {
    m.polygonOffset = true
    m.polygonOffsetFactor = 1
    m.polygonOffsetUnits = 1
  }
}

/** 메시에 모서리 선을 붙인다. 형상이 비었으면 붙이지 않는다. */
export function addEdges(mesh: Mesh): LineSegments | null {
  if (!mesh.geometry.getAttribute('position')?.count) return null
  const lines = edgeLines(mesh.geometry)
  offsetFaces(mesh)
  mesh.add(lines)
  return lines
}
