#!/usr/bin/env node
// 온톨로지 질문 시험대(ADR-0050). DT 화면이 묻는 질문(scripts/onto-questions.mjs)에 우리 TTL 과 받는 쪽 DT 파서가 읽는 만큼이
// 각각 답하는지 재고, --ask 면 온톨로지 챗봇(gemini)에 같은 질문을 말로 물어 답에 기대한 이름·수가 들었는지 채점한다.
//
//   node scripts/onto-bench.mjs                         반영본 전부(data/.layouts) + ONTO_FILES
//   node scripts/onto-bench.mjs duplex=a.ttl clinic=b.ttl
//   node scripts/onto-bench.mjs … --ask                 gemini 에도 묻는다(55 처럼 gemini 가 되는 곳에서). DOCS_CHAT_GEMINI 등은 docs-chat.mjs
//   node scripts/onto-bench.mjs … --out 결과.md
//
// "BIM 에 없음" 은 그 건물에 질문할 대상이 없다는 뜻이다(예: 흐름 방향이 없는 Duplex 의 상류·담당 공간). "TTL 밖" 은 온톨로지에
// 애초에 없는 정보다(로봇 통과 — GeoJSON). gemini 는 TTL 밖 질문에 "없다" 고 답해야 맞다.
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadOntology, query } from './onto-graph.mjs'
import { QUESTIONS } from './onto-questions.mjs'
import { sources } from './onto-sources.mjs'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/** 한 건물의 질문마다 { 질문, 우리 TTL 답, 받는 쪽 답, 판정 }. */
export function benchOntology(text) {
  const o = loadOntology(text)
  return QUESTIONS.map((Q) => {
    const p = Q.pick(o.full)
    if (!p) return { id: Q.id, f: Q.f, use: Q.use, kind: Q.kind, verdict: 'BIM 에 없음' }
    const text = Q.text(p, o.full)
    const spec = Q.q(p, o.full)
    if (!spec) return { id: Q.id, f: Q.f, use: Q.use, kind: Q.kind, text, verdict: 'TTL 밖', expect: [] }
    const run = (g) => {
      const r = query(g, spec)
      if (r.error) throw new Error(`${Q.id}: ${r.error}`)
      return Q.answer(spec.count ? r.count : r.rows, g).filter((x) => x !== '')
    }
    const full = run(o.full)
    const recv = run(o.receiver)
    const same = full.length > 0 && JSON.stringify([...full].sort()) === JSON.stringify([...recv].sort())
    const verdict = !full.length ? '답 없음' : same ? '받는 쪽도 답함' : recv.length && recv[0] !== '0' ? '받는 쪽은 일부' : '우리 TTL 만'
    return { id: Q.id, f: Q.f, use: Q.use, kind: Q.kind, text, patterns: spec.patterns, full, receiver: recv, verdict, expect: full }
  })
}

/** gemini 답 채점: 기대한 이름·수가 답 글에 들었나. TTL 밖은 "없다" 고 했나. */
export function score(row, answer) {
  const t = String(answer || '').replace(/\s+/g, ' ')
  if (row.verdict === 'TTL 밖') return /없|읽지 않|알 수 없|모른|담겨 있지 않|포함되어 있지 않|GeoJSON/.test(t)
  if (row.kind === 'count') return new RegExp(`(^|[^\\d])${row.expect[0]}([^\\d]|$)`).test(t.replace(/,/g, ''))
  const items = [...new Set(row.expect)]
  const need = Math.min(items.length, 5)
  // Revit 이름("패밀리:유형:요소 ID")은 줄여 말하기 쉽다. 끝의 요소 ID 가 있으면 그것으로도 맞힌 것으로 친다.
  const said = (x) => {
    const s = String(x).trim()
    const id = /:(\d{5,})$/.exec(s)?.[1]
    return t.includes(s) || (!!id && t.includes(id))
  }
  const hits = items.filter(said).length
  return need > 0 && hits >= need
}

const short = (xs, n = 6) => (xs.length > n ? `${xs.slice(0, n).join(', ')} 외 ${xs.length - n}` : xs.join(', ')) || '—'

function table(name, rows) {
  const lines = [`### ${name}`, '', '| # | 피처 | DT 화면 | 질문 | 우리 TTL 답 | 받는 쪽 | 판정 |' + (rows.some((r) => r.gemini) ? ' gemini |' : ''), '|---|---|---|---|---|---|---|' + (rows.some((r) => r.gemini) ? '---|' : '')]
  for (const r of rows) {
    const g = r.gemini ? ` ${r.gemini.ok ? (r.gemini.pass ? '✅' : '❌') : '⚠'} ${(r.gemini.ms / 1000).toFixed(0)}초 |` : rows.some((x) => x.gemini) ? ' |' : ''
    lines.push(`| ${r.id} | ${r.f} | ${r.use} | ${r.text ?? '—'} | ${r.full ? short(r.full) : '—'} | ${r.receiver ? short(r.receiver) : '—'} | ${r.verdict} |${g}`)
  }
  const n = rows.length
  const asked = rows.filter((r) => r.verdict !== 'BIM 에 없음')
  const c = (v) => rows.filter((r) => r.verdict === v).length
  lines.push('', `질문 ${n} · 대상 있음 ${asked.length} · 우리 TTL 이 답함 ${c('받는 쪽도 답함') + c('받는 쪽은 일부') + c('우리 TTL 만')} · 받는 쪽도 답함 ${c('받는 쪽도 답함')} · 우리 TTL 만 ${c('우리 TTL 만')} · TTL 밖 ${c('TTL 밖')}`)
  const g = rows.filter((r) => r.gemini)
  if (g.length) lines.push(`gemini 정답 ${g.filter((r) => r.gemini.pass).length}/${g.length} · 평균 ${(g.reduce((s, r) => s + r.gemini.ms, 0) / g.length / 1000).toFixed(1)}초`)
  return lines.join('\n')
}

async function main() {
  const args = process.argv.slice(2)
  const askToo = args.includes('--ask')
  const outAt = args.indexOf('--out')
  const outFile = outAt >= 0 ? args[outAt + 1] : null
  const named = args.filter((a, i) => /=/.test(a) && !(outAt >= 0 && i === outAt + 1))
  const files = named.length ? named.join(';') : process.env.ONTO_FILES || ''
  const list = sources(resolve(process.env.ONTO_DATA || 'data'), files)
  if (!list.length) {
    console.error('볼 TTL 이 없다. 이름=경로.ttl 을 주거나 반영본(data/.layouts)이 있는 곳에서 돌린다')
    process.exit(1)
  }
  let chat = null
  if (askToo) {
    const { createChat } = await import('./docs-chat.mjs')
    chat = createChat({
      root: ROOT,
      log: (f) => process.stderr.write(`${JSON.stringify(f)}\n`),
      name: 'onto',
      mcp: { script: 'scripts/onto-mcp.mjs', env: { ONTO_DATA: resolve(process.env.ONTO_DATA || 'data'), ONTO_FILES: files } },
      policyFile: 'scripts/onto-chat.policy.toml',
      systemFile: 'scripts/onto-chat.md',
      context: (b) => `[건물] source="${b.source}" — 도구를 부를 때 source 로 넘긴다.`,
    })
  }
  const parts = [`# 온톨로지 질문 시험대 — ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`, '']
  for (const s of list) {
    const rows = benchOntology(readFileSync(s.file, 'utf8'))
    if (chat) {
      for (const r of rows) {
        if (r.verdict === 'BIM 에 없음') continue
        const a = await chat.ask(r.text, { body: { source: s.source } })
        r.gemini = { ok: a.ok, pass: a.ok && score(r, a.text), ms: a.ms, tools: a.tools.map((t) => t.name), text: a.text, error: a.error }
        process.stderr.write(`${s.source} ${r.id} ${r.gemini.pass ? 'pass' : 'fail'} ${a.ms}ms ${a.error ?? ''}\n`)
      }
    }
    parts.push(table(`${s.source} (${s.title})`, rows), '')
    if (chat) {
      parts.push('<details><summary>gemini 답 원문</summary>', '')
      for (const r of rows.filter((x) => x.gemini)) parts.push(`**${r.id} ${r.text}** — 도구: ${r.gemini.tools.join(' → ') || '없음'}`, '', r.gemini.error ? `⚠ ${r.gemini.error}` : r.gemini.text, '')
      parts.push('</details>', '')
    }
  }
  chat?.close()
  const md = parts.join('\n')
  if (outFile) writeFileSync(outFile, md)
  console.log(md)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main()
