// 압축하지 않는(STORE) zip. BCF(export/bcf.ts)를 묶는 데 쓴다 — 라이브러리를 들이지 않으려고 직접 쓴다.
// 파일 이름은 UTF-8 이고 일반 목적 비트 11 을 세운다(한글 이름이 깨지지 않게).

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

export function crc32(data: Uint8Array): number {
  let c = 0xffffffff
  for (let i = 0; i < data.length; i++) c = CRC_TABLE[(c ^ data[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

/** files 를 순서대로 담은 zip. 날짜는 1980-01-01 로 둔다(같은 입력이면 같은 바이트). */
export function storeZip(files: readonly { name: string; data: Uint8Array | string }[]): Uint8Array {
  const enc = new TextEncoder()
  const parts: Uint8Array[] = []
  const central: Uint8Array[] = []
  let offset = 0
  for (const f of files) {
    const name = enc.encode(f.name)
    const data = typeof f.data === 'string' ? enc.encode(f.data) : f.data
    const crc = crc32(data)
    const local = new Uint8Array(30 + name.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true) // 풀 때 필요한 판
    lv.setUint16(6, 0x0800, true) // UTF-8 이름
    lv.setUint16(8, 0, true) // STORE
    lv.setUint16(10, 0, true) // 시각
    lv.setUint16(12, 0x21, true) // 날짜 1980-01-01
    lv.setUint32(14, crc, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, data.length, true)
    lv.setUint16(26, name.length, true)
    lv.setUint16(28, 0, true)
    local.set(name, 30)
    parts.push(local, data)

    const c = new Uint8Array(46 + name.length)
    const cv = new DataView(c.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, 0, true)
    cv.setUint16(14, 0x21, true)
    cv.setUint32(16, crc, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, data.length, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    c.set(name, 46)
    central.push(c)
    offset += local.length + data.length
  }
  const size = central.reduce((s, c) => s + c.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, files.length, true)
  ev.setUint16(10, files.length, true)
  ev.setUint32(12, size, true)
  ev.setUint32(16, offset, true)
  const out = new Uint8Array(offset + size + 22)
  let at = 0
  for (const p of [...parts, ...central, end]) {
    out.set(p, at)
    at += p.length
  }
  return out
}

/** storeZip 이 쓴 zip 을 다시 읽는다(시험용·STORE 만). */
export function readStoreZip(zip: Uint8Array): Map<string, Uint8Array> {
  const dv = new DataView(zip.buffer, zip.byteOffset, zip.byteLength)
  const out = new Map<string, Uint8Array>()
  const dec = new TextDecoder()
  let at = 0
  while (at + 30 <= zip.length && dv.getUint32(at, true) === 0x04034b50) {
    const method = dv.getUint16(at + 8, true)
    const size = dv.getUint32(at + 18, true)
    const nameLen = dv.getUint16(at + 26, true)
    const extra = dv.getUint16(at + 28, true)
    const name = dec.decode(zip.subarray(at + 30, at + 30 + nameLen))
    const start = at + 30 + nameLen + extra
    if (method !== 0) throw new Error(`STORE 가 아니다: ${name}`)
    out.set(name, zip.subarray(start, start + size))
    at = start + size
  }
  return out
}
