// FBX(바이너리)에서 Model 마다 사용자 속성을 읽는다. 내보낸 파일 뷰어가 FBX 를 GLB 처럼 kind·name 을 가진 객체로 보이려고 쓴다.
//
// 에디터의 FBX 는 GLB extras(kind·name·systemId …)를 Model 의 Properties70 에 플래그 `U`(사용자 정의)인 P 줄로 남긴다
// (scripts/glb2fbx.py, ADR-0052). Unity 가 OnPostprocessGameObjectWithUserProperties 로 받는 값이 이것이다. three 의 FBXLoader 는
// 이 줄을 읽고도 객체에 붙이지 않아서 여기서 따로 읽는다. 형상 배열은 길이만 보고 건너뛰므로 압축을 풀지 않는다(성수 225MB).
//
// 바이너리 레코드: [끝 위치, 속성 수, 속성 목록 길이](7500 부터 8바이트씩, 그 전 4바이트씩) · 이름 길이(1) · 이름 · 속성들 · 자식들.
// 끝 위치가 0 인 레코드는 자식 목록의 끝이다. ASCII FBX 는 읽지 않는다(빈 표를 돌려준다).
import { PropertyBinding } from 'three'

export type FbxValue = string | number | boolean
/** 열쇠는 FBXLoader 가 붙이는 객체 이름이다(Model 이름을 PropertyBinding.sanitizeNodeName 으로 거른 것). */
export type FbxUserProps = Map<string, Record<string, FbxValue>>

const MAGIC = 'Kaydara FBX Binary  \0'

type Value = FbxValue | bigint | null

export function readFbxUserProps(data: ArrayBuffer): FbxUserProps {
  const out: FbxUserProps = new Map()
  const bytes = new Uint8Array(data)
  if (bytes.length < 27 || String.fromCharCode(...bytes.subarray(0, MAGIC.length)) !== MAGIC) return out
  const view = new DataView(data)
  const wide = view.getUint32(23, true) >= 7500
  const utf8 = new TextDecoder()
  const word = (at: number) => (wide ? Number(view.getBigUint64(at, true)) : view.getUint32(at, true))
  const W = wide ? 8 : 4

  type Record_ = { name: string; end: number; count: number; propsAt: number; childrenAt: number }
  function record(at: number): Record_ | null {
    if (at + 3 * W + 1 > bytes.length) return null
    const end = word(at)
    if (end === 0) return null
    const count = word(at + W)
    const listLen = word(at + 2 * W)
    const nameLen = bytes[at + 3 * W]
    const nameAt = at + 3 * W + 1
    const name = String.fromCharCode(...bytes.subarray(nameAt, nameAt + nameLen))
    return { name, end, count, propsAt: nameAt + nameLen, childrenAt: nameAt + nameLen + listLen }
  }
  function* children(r: Record_): Generator<Record_> {
    let at = r.childrenAt
    while (at < r.end) {
      const c = record(at)
      if (!c) return
      yield c
      at = c.end
    }
  }
  function values(r: Record_): Value[] {
    const out: Value[] = []
    let at = r.propsAt
    for (let i = 0; i < r.count; i++) {
      const type = String.fromCharCode(bytes[at++])
      switch (type) {
        case 'C': out.push(bytes[at] !== 0); at += 1; break
        case 'Y': out.push(view.getInt16(at, true)); at += 2; break
        case 'I': out.push(view.getInt32(at, true)); at += 4; break
        case 'F': out.push(view.getFloat32(at, true)); at += 4; break
        case 'D': out.push(view.getFloat64(at, true)); at += 8; break
        case 'L': out.push(view.getBigInt64(at, true)); at += 8; break
        case 'S':
        case 'R': {
          const len = view.getUint32(at, true)
          out.push(type === 'S' ? utf8.decode(bytes.subarray(at + 4, at + 4 + len)) : null)
          at += 4 + len
          break
        }
        // 배열(f d l i b c): 원소 수 · 압축 여부 · 바이트 수 · 바이트. 사용자 속성은 배열이 아니라 건너뛴다.
        case 'f': case 'd': case 'l': case 'i': case 'b': case 'c':
          out.push(null)
          at += 12 + view.getUint32(at + 8, true)
          break
        default:
          throw new Error(`FBX 속성 형식 '${type}' 을 모릅니다`)
      }
    }
    return out
  }

  let at = 27
  for (let top = record(at); top; top = record(at)) {
    at = top.end
    if (top.name !== 'Objects') continue
    for (const model of children(top)) {
      if (model.name !== 'Model') continue
      const name = values(model)[1]
      if (typeof name !== 'string') continue
      const p70 = [...children(model)].find((c) => c.name === 'Properties70')
      if (!p70) continue
      const props: Record<string, FbxValue> = {}
      for (const p of children(p70)) {
        if (p.name !== 'P') continue
        const v = values(p)
        // P: 이름, 형식, 분류, 플래그, 값… 값이 하나인 사용자 속성만 둔다(벡터·색 같은 여러 값은 우리 내보내기에 없다).
        if (typeof v[0] !== 'string' || typeof v[3] !== 'string' || !v[3].includes('U') || v.length !== 5) continue
        const value = v[4]
        if (typeof value === 'bigint') props[v[0]] = Number(value)
        else if (value !== null) props[v[0]] = value
      }
      // Model 이름은 "이름\0\x01Model" 이다. FBXLoader 와 같은 규칙(첫 \0 에서 자르고 sanitizeNodeName)으로 걸러야 객체 이름과 맞는다.
      if (Object.keys(props).length) out.set(PropertyBinding.sanitizeNodeName(name.split('\0')[0]), props)
    }
    break
  }
  return out
}
