// 온톨로지 질의 챗봇이 볼 수 있는 TTL(ADR-0050). onto-mcp.mjs 의 도구와 serve.mjs 의 GET /__ask(창의 건물 고르기)가 같이 쓴다.
//   반영본 — data/.layouts/<열쇠>/current.json 이 가리키는 vN/ontology.ttl(src/server/layouts.ts). source 는 열쇠 폴더 이름 앞 12자,
//   key 는 반영 API(/__data/__layouts?key=)의 열쇠 — 창이 답의 id 를 내보낸 파일 뷰어(viewer.html?key=…&v=…&select=…)로 잇는다.
//   ONTO_FILES="이름=경로;…" — 반영본이 없는 PC·시험에서 볼 TTL 파일.
//   화면 기준 — ONTO_SCREENS 폴더의 <토큰>.ttl. [온톨로지] 칸에서 "지금 화면(반영 전)" 을 고르면 화면이 올린 TTL 이다(scripts/onto-screen.mjs).
//   source 는 `screen-<토큰>`, screen: true. 반영본과 섞이지 않게 기본 출처(source 를 안 준 질문)로는 고르지 않는다.
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { basename, join } from 'node:path'

/** 볼 수 있는 TTL. 반영본(건물마다 현재 버전) + ONTO_FILES + 화면 기준(ONTO_SCREENS). */
export function sources(data, files = '', screens = '') {
  const out = []
  const layouts = join(data, '.layouts')
  if (existsSync(layouts)) {
    for (const dir of readdirSync(layouts)) {
      try {
        const base = join(layouts, dir)
        const key = JSON.parse(readFileSync(join(base, 'key.json'), 'utf8'))
        const { version } = JSON.parse(readFileSync(join(base, 'current.json'), 'utf8'))
        const vdir = join(base, `v${version}`)
        const file = join(vdir, 'ontology.ttl')
        if (!existsSync(file)) continue
        const meta = existsSync(join(vdir, 'meta.json')) ? JSON.parse(readFileSync(join(vdir, 'meta.json'), 'utf8')) : {}
        const paths = Array.isArray(key.paths) ? key.paths : String(key.key || dir).split('|')
        out.push({ source: dir.slice(0, 12), title: paths.map((p) => basename(p)).join(' + '), version, at: meta.at, by: meta.by, file, key: String(key.key ?? paths.join('|')) })
      } catch { /* 반만 쓴 폴더는 건너뛴다 */ }
    }
  }
  for (const part of String(files || '').split(';')) {
    const m = /^\s*([^=]+?)\s*=\s*(.+?)\s*$/.exec(part)
    if (m && existsSync(m[2])) out.push({ source: m[1], title: m[1], file: m[2], at: statSync(m[2]).mtime.toISOString() })
  }
  if (screens && existsSync(screens)) {
    for (const f of readdirSync(screens)) {
      const m = /^([a-z0-9]{16,40})\.ttl$/.exec(f)
      if (!m) continue
      try {
        const meta = JSON.parse(readFileSync(join(screens, `${m[1]}.json`), 'utf8'))
        out.push({ source: `screen-${m[1]}`, title: `${meta.title || '화면'} · 지금 화면(반영 전)`, at: meta.at, by: meta.by, file: join(screens, f), screen: true })
      } catch { /* 메타를 쓰기 전이면 건너뛴다 */ }
    }
  }
  return out
}
