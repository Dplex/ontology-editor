// 프로토타입 저장소 — 프로젝트 목록을 브라우저 IndexedDB 에 둔다.
// localStorage 는 한도가 5MB 안팎이라 성수(건축+기계) 같은 큰 사이트는 임시 저장·버전이 들어가지 않았다(2026-10-16).
// IndexedDB 는 디스크 여유만큼 쓸 수 있다. 옛 localStorage 저장본은 처음 열 때 한 번 옮기고 지운다.
const DB = 'ontology-platform-prototype'
const STORE = 'kv'
const KEY = 'projects'

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function tx<T>(mode: IDBTransactionMode, run: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open()
  try {
    return await new Promise<T>((resolve, reject) => {
      const t = db.transaction(STORE, mode)
      const req = run(t.objectStore(STORE))
      t.oncomplete = () => resolve(req.result)
      t.onerror = () => reject(t.error ?? req.error)
      t.onabort = () => reject(t.error ?? new Error('저장이 중단됐습니다.'))
    })
  } finally { db.close() }
}

/** 저장본 문자열. 없으면 null. localStorage 에 옛 저장본(legacyKey)이 있으면 IndexedDB 로 옮겨 온다. */
export async function loadSaved(legacyKey: string): Promise<string | null> {
  const saved = await tx<string | undefined>('readonly', s => s.get(KEY))
  if (typeof saved === 'string') return saved
  const legacy = localStorage.getItem(legacyKey)
  if (legacy) {
    await tx('readwrite', s => s.put(legacy, KEY))
    localStorage.removeItem(legacyKey)
  }
  return legacy
}

// 쓰기는 마지막 것만 남긴다 — 편집마다 큰 문자열을 차례로 쌓지 않는다.
let pending: string | null = null
let running: Promise<void> | null = null
export function save(body: string, onError: (e: unknown) => void): void {
  pending = body
  if (running) return
  running = (async () => {
    while (pending !== null) {
      const next = pending; pending = null
      try { await tx('readwrite', s => s.put(next, KEY)) } catch (e) { onError(e) }
    }
    running = null
  })()
}

/** 쓰기가 끝날 때까지 기다린다(시험 · 내려받기 전). */
export async function flush(): Promise<void> { while (running) await running }

/** 저장본을 지운다(시험·데모 초기화). */
export async function clearSaved(): Promise<void> { await tx('readwrite', s => s.delete(KEY)); localStorage.removeItem('ontology-platform-prototype-v1') }
