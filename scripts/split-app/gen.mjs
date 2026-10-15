// a.json(analyze.mjs) + parts.mjs → src/editor/*.ts·src/components/editor/*.vue·새 App.vue. run.sh 가 부른다.
// node gen.mjs <repo> a.json [--write]  (ORIG=나누기 전 App.vue)
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
import { PARTS, MOVE, CHUNKS } from './parts.mjs'

const repo = process.argv[2]
const A = JSON.parse(fs.readFileSync(process.argv[3], 'utf8'))
const WRITE = process.argv.includes('--write')
const require = createRequire(path.join(repo, 'package.json'))
const { compileTemplate } = require('@vue/compiler-sfc')
const { parse: parseTpl } = require('@vue/compiler-dom')

const src = fs.readFileSync(process.env.ORIG, 'utf8')
const appLines = src.split('\n')
const script = A.script
const stmts = A.stmts

// 섹션 머리 줄 번호
const partStart = PARTS.map(([head, name], k) => {
  if (head === null) return { name, line: 0 }
  const idx = appLines.findIndex((l) => l.startsWith(head))
  if (idx < 0) throw new Error('머리를 못 찾음: ' + head)
  return { name, line: idx + 1 }
})
for (let k = 1; k < partStart.length; k++) if (partStart[k].line <= partStart[k - 1].line) throw new Error('순서: ' + partStart[k].name)
const partOf = (line) => {
  let p = partStart[0].name
  for (const ps of partStart) if (ps.line <= line) p = ps.name
  return p
}

// 선언 이름 → 문장
const declOf = new Map()
const importOf = new Map() // name → { from, text, type, def }
for (const s of stmts) {
  if (s.kind === 'import') {
    for (const sp of s.specs) importOf.set(sp.name, { from: s.from, text: sp.text, type: sp.type || s.typeOnly, def: sp.def })
    continue
  }
  s.part = partOf(s.line)
  const moved = s.names.map((n) => MOVE[n]).find(Boolean)
  if (moved) { s.part = moved; s.moved = true }
  for (const n of s.names) declOf.set(n, s)
}

// 앞 문장 줄 끝의 꼬리 주석은 앞 문장에 붙인다
for (let k = 0; k < stmts.length; k++) {
  const s = stmts[k]
  s.textStart = s.pos
  const nl = script.indexOf('\n', s.pos)
  if (nl >= 0 && nl < s.sPos) {
    const head = script.slice(s.pos, nl)
    if (head.trim() && k > 0) {
      stmts[k - 1].tail = head
      s.textStart = nl
    }
  }
}
const tplRanges = A.tpl
const inTpl = (off) => tplRanges.some(([a, b]) => off > a && off < b)

// 템플릿이 쓰는 이름
const tStart = appLines.findIndex((l, i) => i > A.end && l.startsWith('<template>'))
const tEnd = appLines.length - 1 - [...appLines].reverse().findIndex((l) => l.startsWith('</template>'))
const template = appLines.slice(tStart + 1, tEnd).join('\n')
const allNames = [...declOf.keys(), ...importOf.keys()]
function templateNames(tpl) {
  const bindingMetadata = Object.fromEntries(allNames.map((n) => [n, 'setup-maybe-ref']))
  const r = compileTemplate({ source: tpl, filename: 'x.vue', id: 'x', compilerOptions: { bindingMetadata, prefixIdentifiers: true, mode: 'module' } })
  if (r.errors.length) throw new Error(String(r.errors[0]))
  const used = new Set()
  for (const m of r.code.matchAll(/\$setup(?:\.([A-Za-z_$][\w$]*)|\["([^"]+)"\])/g)) used.add(m[1] ?? m[2])
  // 문자열 템플릿 ref(ref="x")는 script setup 의 바인딩이어야 그 ref 에 꽂힌다
  for (const m of tpl.matchAll(/\sref="([A-Za-z_$][\w$]*)"/g)) if (allNames.includes(m[1])) used.add(m[1])
  // 템플릿 식 안의 타입(as Surface 등)
  for (const n of allNames) {
    const isType = declOf.get(n)?.isType || importOf.get(n)?.type
    if (isType && new RegExp('\\b' + n + '\\b').test(tpl)) used.add(n)
  }
  return used
}
const tplUsed = templateNames(template)

// 모듈별 문장
const mods = new Map(PARTS.map(([, n]) => [n, { name: n, decls: [], effects: [], uses: new Set(), typeUses: new Set() }]))
// 화면이 붙을 때 만들어야 하는 선언(컴포넌트 수명에 묶인 것)
const SETUP_DECL = { replay: 'ReturnType<typeof useReplay>', layoutPoll: 'number', lockTimer: 'number' }
// 가져올 때 바로 돌아도 되는(뒤 선언이 그 결과를 읽는) 문장
const KEEP_TOP = new Set([A.stmts.find((s) => s.kind === 'TryStatement')?.i])
const ordered = [...stmts.filter((s) => s.moved), ...stmts.filter((s) => !s.moved)]
for (const s of ordered) {
  if (s.kind === 'import') continue
  const m = mods.get(s.part)
  if (s.effect && !KEEP_TOP.has(s.i)) m.effects.push(s)
  else m.decls.push(s)
  for (const r of s.refs) m.uses.add(r)
  for (const r of s.typeRefs) m.typeUses.add(r)
}

// 다른 모듈·템플릿이 쓰는 선언 → export
const exported = new Set()
for (const m of mods.values()) for (const n of [...m.uses, ...m.typeUses]) {
  const d = declOf.get(n)
  if (d && d.part !== m.name) exported.add(n)
}
for (const n of tplUsed) if (declOf.has(n)) exported.add(n)

// 문제 찾기: 다른 모듈의 let 에 대입, 가져올 때 바로 읽는 다른 모듈 값
const problems = []
for (const s of stmts) {
  if (s.kind === 'import') continue
  for (const a of s.assigns) {
    const d = declOf.get(a)
    if (d && d.part !== s.part) problems.push(`대입 ${s.part}:${s.line} → ${a} (${d.part}:${d.line})`)
  }
  if (!s.effect || KEEP_TOP.has(s.i))
    for (const e of s.eager) {
      const d = declOf.get(e)
      if (d && d.part !== s.part && d.kind !== 'FunctionDeclaration' && !d.isType) problems.push(`즉시 ${s.part}:${s.line} ${s.names} → ${e} (${d.part}:${d.line})`)
    }
}

// 다른 모듈이 대입하는 let → 그 모듈에 setX 를 두고 대입을 setX(...) 로 바꾼다(ES 모듈의 import 는 읽기 전용).
const needSetter = new Set()
for (const s of stmts) for (const a of s.assignAt ?? []) {
  const d = declOf.get(a.name)
  if (d && d.part !== s.part) { if (a.odd) throw new Error('대입 모양: ' + a.name + ' @' + s.line); needSetter.add(a.name); s.uses ??= []; }
}
const setterName = (n) => 'set' + n.replace(/^\w/, (c) => c.toUpperCase())
for (const n of needSetter) if (declOf.has(setterName(n))) throw new Error('이미 있는 이름: ' + setterName(n))
for (const s of stmts) for (const a of s.assignAt ?? []) {
  const d = declOf.get(a.name)
  if (d && d.part !== s.part) { mods.get(s.part).uses.add(setterName(a.name)); declOf.set(setterName(a.name), { part: d.part, kind: 'FunctionDeclaration', names: [setterName(a.name)] }); exported.add(setterName(a.name)) }
}
const problems2 = problems.filter((p) => !p.startsWith('대입'))
problems.length = 0; problems.push(...problems2)

const camel = (n) => n.replace(/-(\w)/g, (_, c) => c.toUpperCase())
const pascal = (n) => camel(n).replace(/^\w/, (c) => c.toUpperCase())
const setupName = (n) => 'setup' + pascal(n)

function rel(from, dir) {
  if (!from.startsWith('.')) return from
  return path.relative(dir, path.join(repo, 'src', from)).replace(/^(?!\.)/, './')
}

function importsFor(names, typeNames, dir, selfPart) {
  const byFrom = new Map()
  const add = (from, spec, def) => {
    if (!byFrom.has(from)) byFrom.set(from, { def: null, specs: new Set() })
    if (def) byFrom.get(from).def = spec
    else byFrom.get(from).specs.add(spec)
  }
  for (const n of new Set([...names, ...typeNames])) {
    const d = declOf.get(n)
    if (d) {
      if (d.part === selfPart) continue
      const from = d.part === '__app' ? null : './' + d.part
      add(rel('./editor/' + d.part, dir), d.isType ? `type ${n}` : n)
      continue
    }
    const im = importOf.get(n)
    if (!im) continue
    const typeOnly = im.type || (!names.has(n) && false)
    add(rel(im.from, dir), im.def ? im.text : (im.type && !im.text.startsWith('type ') ? 'type ' + im.text : im.text), im.def)
  }
  const order = [...byFrom.keys()].sort((a, b) => rank(a) - rank(b) || a.localeCompare(b))
  return order
    .map((from) => {
      const { def, specs } = byFrom.get(from)
      const list = [...specs].sort((a, b) => a.replace(/^type /, '').localeCompare(b.replace(/^type /, '')))
      const allType = list.length && list.every((x) => x.startsWith('type ')) && !def
      const inner = allType ? list.map((x) => x.slice(5)) : list
      const braces = inner.length ? `{ ${inner.join(', ')} }` : ''
      return `import ${allType ? 'type ' : ''}${[def, braces].filter(Boolean).join(', ')} from '${from}'`
    })
    .join('\n')
}
function rank(from) {
  if (!from.startsWith('.')) return 0
  if (from.includes('/lib/')) return 1
  if (from.includes('/components/')) return 2
  return 3
}

function stmtText(s, { exportIt, indent }) {
  // 대입 바꾸기(줄 수는 그대로)
  const edits = (s.assignAt ?? []).filter((a) => { const d = declOf.get(a.name); return !a.odd && d && d.part !== s.part })
  let raw = script.slice(s.textStart, s.endPos)
  const indentLines = new Set()
  {
    let off = s.textStart
    raw.split('\n').forEach((line, k) => { if (line.trim() && !inTpl(off)) indentLines.add(k); off += line.length + 1 })
  }
  for (const a of [...edits].sort((x, y) => y.start - x.start)) {
    const st = a.start - s.textStart, rs = a.rStart - s.textStart, en = a.end - s.textStart
    raw = raw.slice(0, st) + setterName(a.name) + '(' + raw.slice(rs, en) + ')' + raw.slice(en)
  }
  const cut = s.sPos - s.textStart
  let pre = raw.slice(0, cut)
  let body = raw.slice(cut) + (s.tail ?? '')
  if (s.names.some((n) => n in SETUP_DECL)) throw new Error('SETUP_DECL 은 따로')
  if (exportIt) body = 'export ' + body
  let text = pre + body
  // import.meta.url 기준 경로는 파일이 src/editor/ 로 내려가며 한 단계 깊어진다
  text = text.replace(/new URL\('\.\/(lib\/[^']+)', import\.meta\.url\)/g, "new URL('../$1', import.meta.url)")
  if (indent) text = text.split('\n').map((line, k) => (indentLines.has(k) ? '  ' + line : line)).join('\n')
  return text
}

const outDir = path.join(repo, 'src/editor')
const files = {}
for (const m of mods.values()) {
  const dir = outDir
  let body = ''
  const setupLines = []
  for (const s of m.decls) {
    const setupDecl = s.names.find((n) => n in SETUP_DECL)
    if (setupDecl) {
      // `const x = f()` → `export let x: T` + 화면이 붙을 때 `x = f()`
      const pre = script.slice(s.textStart, s.sPos)
      const txt = script.slice(s.sPos, s.endPos).replace(/^const /, '')
      body += `${pre}${exported.has(setupDecl) ? 'export ' : ''}let ${setupDecl}: ${SETUP_DECL[setupDecl]}`
      setupLines.push({ i: s.i, text: '\n' + txt.split('\n').map((l) => '  ' + l).join('\n') })
      continue
    }
    const exp = s.names.some((n) => exported.has(n))
    body += stmtText(s, { exportIt: exp })
    for (const n of s.names) if (needSetter.has(n)) body += `\nexport function ${setterName(n)}(v: typeof ${n}) {\n  ${n} = v\n}`
  }
  const effects = [...m.effects.map((s) => ({ i: s.i, text: stmtText(s, { indent: true }) })), ...setupLines].sort((a, b) => a.i - b.i)
  if (effects.length) {
    body += `\n\n/** 화면이 붙을 때 한 번 — 이 모듈의 watch·이벤트·타이머. App.vue 가 부른다. */\nexport function ${setupName(m.name)}() {${effects.map((e) => e.text.replace(/^\n+/, '\n')).join('')}\n}`
    m.setup = setupName(m.name)
  }
  const used = new Set(m.uses)
  if (m.setup && setupLines.length) for (const n of ['useReplay']) used.add(n)
  const imports = importsFor(used, m.typeUses, dir, m.name)
  files[m.name] = imports + '\n' + body.replace(/^\n+/, '\n') + '\n'
}

// --- 2단계: 템플릿 덩어리를 자식 컴포넌트로 -------------------------------------------
const compDir = path.join(repo, 'src/components/editor')
const chunkNames = new Set(CHUNKS.map((c) => c.name))
function namesIn(tpl) {
  const bindingMetadata = Object.fromEntries([...allNames, ...chunkNames].map((n) => [n, 'setup-maybe-ref']))
  const r = compileTemplate({ source: tpl, filename: 'x.vue', id: 'x', compilerOptions: { bindingMetadata, prefixIdentifiers: true, mode: 'module' } })
  if (r.errors.length) throw new Error(String(r.errors[0]) + '\n' + tpl.slice(0, 300))
  const used = new Set()
  for (const m of r.code.matchAll(/\$setup(?:\.([A-Za-z_$][\w$]*)|\["([^"]+)"\])/g)) used.add(m[1] ?? m[2])
  for (const m of tpl.matchAll(/\sref="([A-Za-z_$][\w$]*)"/g)) if (allNames.includes(m[1])) used.add(m[1])
  for (const n of allNames) {
    const isType = declOf.get(n)?.isType || importOf.get(n)?.type
    if (isType && new RegExp('\\b' + n + '\\b').test(tpl)) used.add(n)
  }
  const free = new Set([...r.code.matchAll(/_ctx\.([A-Za-z_$][\w$]*)/g)].map((m) => m[1]))
  return { used, free }
}
let tsrc = template
const ast = parseTpl(tsrc, { comments: true })
const lineStartOf = (off) => tsrc.lastIndexOf('\n', off - 1) + 1
const lineAt = (off) => tsrc.slice(lineStartOf(off), tsrc.indexOf('\n', off) < 0 ? tsrc.length : tsrc.indexOf('\n', off))
function* walkEls(n, anc = []) {
  for (const c of n.children ?? []) {
    if (c.type === 1) { yield [c, anc]; yield* walkEls(c, [...anc, c]) }
    else if (c.type === 9) for (const b of c.branches) yield* walkEls(b, anc) // v-if 가지(파서는 안 만듦)
  }
}
const els = [...walkEls(ast)]
function findEl(sub) {
  const openTag = (e) => tsrc.slice(e.loc.start.offset, e.children.length ? e.children[0].loc.start.offset : e.loc.end.offset)
  const hits = els.filter(([e]) => openTag(e).includes(sub) && tsrc.slice(lineStartOf(e.loc.start.offset), e.loc.start.offset).trim() === '')
  if (hits.length !== 1) throw new Error(`덩어리 시작 ${hits.length}개: ${sub}`)
  return hits[0]
}
const LIFT = (p) => (p.type === 7 && ['if', 'else-if', 'else', 'for'].includes(p.name)) || (p.type === 6 && p.name === 'key') || (p.type === 7 && p.name === 'bind' && p.arg?.content === 'key')
const plan = CHUNKS.map((c) => {
  const [el, anc] = findEl(c.find)
  let lastEl = el
  if (c.last) {
    const [l, lanc] = findEl(c.last)
    if (lanc.at(-1) !== anc.at(-1)) throw new Error('형제가 아님: ' + c.name)
    lastEl = l
  }
  const memo = [...anc].reverse().map((a) => a.props.find((p) => p.type === 7 && p.name === 'memo')).find(Boolean)
  return { ...c, el, anc, lastEl, start: el.loc.start.offset, end: lastEl.loc.end.offset, memo: memo ? memo.exp.content : null, sibs: c.last ? (anc.at(-1)?.children ?? []).filter((x) => x.type === 1 && x.loc.start.offset >= el.loc.start.offset && x.loc.start.offset <= lastEl.loc.start.offset) : [el] }
})
function topAnd(exp) {
  const out = []; let depth = 0, cur = '', q = null
  for (let i = 0; i < exp.length; i++) {
    const ch = exp[i]
    if (q) { cur += ch; if (ch === q && exp[i - 1] !== '\\') q = null; continue }
    if (ch === "'" || ch === '"' || ch === '`') { q = ch; cur += ch; continue }
    if ('([{'.includes(ch)) depth++
    if (')]}'.includes(ch)) depth--
    if (depth === 0 && ch === '&' && exp[i + 1] === '&') { out.push(cur); cur = ''; i++; continue }
    if (depth === 0 && ch === '|' && exp[i + 1] === '|') return []
    cur += ch
  }
  out.push(cur)
  return out
}
const kebab = (n) => n.replace(/[A-Z]/g, (c) => '-' + c.toLowerCase())
const edits = [] // {at, delta} 원래 자리 기준
const cur = (orig) => orig + edits.filter((e) => e.at < orig).reduce((n, e) => n + e.delta, 0)
const compFiles = {}
for (const c of [...plan].sort((a, b) => b.start - a.start)) {
  const edit = (origAt, curFrom, curTo, ins) => {
    tsrc = tsrc.slice(0, curFrom) + ins + tsrc.slice(curTo)
    edits.push({ at: origAt, delta: ins.length - (curTo - curFrom) })
  }
  const isTpl = !c.last && c.el.tag === 'template'
  const roots = isTpl ? c.el.children.filter((x) => x.type === 1) : c.sibs
  // 바깥 v-memo 아래에 있던 덩어리는 루트마다 같은 v-memo 를 단다 — 자식 컴포넌트는 제 의존성으로 따로 다시 그려서 부모의 v-memo 가 막지 못한다
  if (c.memo)
    for (const r of [...roots].sort((a, b) => b.loc.start.offset - a.loc.start.offset)) {
      if (r.props.some((p) => p.type === 7 && p.name === 'memo')) continue
      const o = r.loc.start.offset + 1 + r.tag.length
      edit(o, cur(o), cur(o), ` v-memo="${c.memo}"`)
    }
  let lifted = ''
  if (!c.last) {
    // v-if·key 를 부모 쪽 태그로
    const props = c.el.props.filter(LIFT)
    lifted = props.map((p) => ' ' + p.loc.source).join('')
    for (const p of [...props].sort((a, b) => b.loc.start.offset - a.loc.start.offset)) {
      const ps = cur(p.loc.start.offset), pe = cur(p.loc.end.offset)
      let a2 = ps
      while (/[ \t]/.test(tsrc[a2 - 1])) a2--
      if (tsrc[a2 - 1] === '\n') { a2--; while (/[ \t]/.test(tsrc[a2 - 1])) a2-- }
      edit(p.loc.start.offset - (ps - a2), a2, pe, '')
    }
  }
  const s0 = cur(c.start), e0 = cur(c.end)
  let text = isTpl ? tsrc.slice(cur(c.el.children[0].loc.start.offset), cur(c.el.children.at(-1).loc.end.offset)) : tsrc.slice(s0, e0)
  const colAt = isTpl ? c.el.children[0].loc.start.offset : c.start
  const col = cur(colAt) - lineStartOf(cur(colAt))
  // 여러 줄 속성·보간·pre 안의 줄은 들여쓰기를 건드리지 않는다(문자열 값이 바뀐다)
  const keepR = []
  ;(function w(n) {
    for (const ch of n.children ?? []) {
      if (ch.type === 1) {
        for (const p of ch.props) if (p.loc.start.line !== p.loc.end.line) keepR.push([p.loc.start.offset, p.loc.end.offset])
        if (ch.tag === 'pre' || ch.tag === 'textarea') keepR.push([ch.loc.start.offset, ch.loc.end.offset])
      }
      if (ch.type === 5 && ch.loc.start.line !== ch.loc.end.line) keepR.push([ch.loc.start.offset, ch.loc.end.offset])
      w(ch)
    }
  })(parseTpl(text, { comments: true }))
  const keepLine = []
  { let off = 0; for (const l of text.split('\n')) { keepLine.push(keepR.some(([x, y]) => off > x && off < y)); off += l.length + 1 } }
  text = text.split('\n').map((l, k) => {
    if (k === 0) return '  ' + l
    if (keepLine[k]) return l
    if (!l.trim()) return ''
    return (l.startsWith(' '.repeat(col)) ? '  ' + l.slice(col) : '  ' + l.trimStart())
  }).join('\n')
  const { used, free } = namesIn(text)
  if (free.size) throw new Error(`${c.name}: 바깥 범위 변수 ${[...free]}`)
  // 부모 쪽 v-if 가 null 이 아님을 보장한 값은 props 로 받는다. 타입이 좁혀지고, <Transition> 이 이 조각을 내보내는 동안
  // 그 값이 null 이 되어도 떠나는 조각은 옛 값을 들고 있다(원래 한 템플릿일 때 떠나는 vnode 가 다시 그려지지 않던 것과 같다).
  const conds = [...(c.last ? [] : [c.el]), ...c.anc].flatMap((e) => e.props.filter((p) => p.type === 7 && (p.name === 'if' || p.name === 'else-if')).map((p) => p.exp.content))
  const narrowed = [...new Set(conds.flatMap(topAnd).map((x) => x.trim().match(/^([A-Za-z_$][\w$]*)(?:$|\??\.)/)?.[1]).filter(Boolean))].filter((n) => used.has(n) && !new RegExp(`(^|[^\\w$.:@-])${n.replace('$', '\\$')}\\s+=[^=]`).test(text) && declOf.get(n) && declOf.get(n).kind === 'FirstStatement' && !declOf.get(n).letNames.length).sort()
  for (const n of narrowed) used.delete(n)
  const vals = new Set([...used].filter((n) => !chunkNames.has(n)))
  const imp = importsFor(vals, new Set(), compDir, '__none')
  const sub = [...used].filter((n) => chunkNames.has(n)).sort().map((n) => `import ${n} from './${n}.vue'`).join('\n')
  const doc = c.doc ? `// ${c.doc}\n` : ''
  let propsDecl = ''
  if (narrowed.length) {
    const byMod = new Map()
    for (const n of narrowed) { const f = rel('./editor/' + declOf.get(n).part, compDir); byMod.set(f, [...(byMod.get(f) ?? []), `${n} as ${n}Ref`]) }
    const ti = [...byMod].map(([f, xs]) => `import type { ${xs.join(', ')} } from '${f}'`).join('\n')
    propsDecl = `${ti}\n\n// 부모의 v-if 가 null 이 아님을 보장한 값(docs/dev/app-structure.md)\ndefineProps({\n${narrowed.map((n) => `  ${n}: { type: null as unknown as PropType<NonNullable<typeof ${n}Ref.value>>, required: true },`).join('\n')}\n})`
  }
  const vueImp = narrowed.length ? "import type { PropType } from 'vue'" : ''
  compFiles[c.name] = `<script setup lang="ts">\n${doc}${[vueImp, imp, sub].filter(Boolean).join('\n')}${propsDecl ? '\n' + propsDecl : ''}\n</script>\n\n<template>\n${text}\n</template>\n`
  const tag = `<${c.name}${lifted}${narrowed.map((n) => ` :${kebab(n)}="${n}"`).join('')} />`
  tsrc = tsrc.slice(0, s0) + tag + tsrc.slice(e0)
  edits.push({ at: c.start, delta: tag.length - (e0 - s0) })
}
const appTplUsed = namesIn(tsrc).used
const appChunkImports = [...appTplUsed].filter((n) => chunkNames.has(n)).sort().map((n) => `import ${n} from './components/editor/${n}.vue'`).join('\n')

// App.vue 스크립트
const appImports = importsFor(new Set([...appTplUsed].filter((n) => declOf.has(n) || importOf.has(n))), new Set(), path.join(repo, 'src'), '__none') + (appChunkImports ? '\n' + appChunkImports : '')
const setups = [...mods.values()].filter((m) => m.setup)
const indexTs = `// 편집기 상태(src/editor/*.ts)를 화면에 붙인다. 짜임은 docs/dev/app-structure.md.
//
// 상태(ref·computed)와 함수는 모듈 최상위에 있어 import 만으로 쓸 수 있다. watch·이벤트·타이머처럼 화면 수명에 묶인 것은
// 모듈마다 setupXxx() 안에 있고, 여기서 나누기 전 App.vue 의 순서 그대로 부른다(같은 때 도는 watch 의 순서가 그 순서다).
${setups.map((m) => `import { ${m.setup} } from './${m.name}'`).join('\n')}

/** App.vue 의 setup 에서 한 번 부른다. */
export function setupEditor() {
${setups.map((m) => `  ${m.setup}()`).join('\n')}
}
`
const appScript = `// 편집기 화면의 껍데기. 상태·동작은 src/editor/, 화면 조각은 src/components/editor/ 에 있다(docs/dev/app-structure.md).
${appImports}
import { setupEditor } from './editor/index'

setupEditor()
`

console.log('problems', problems.length)
for (const p of problems) console.log(' ', p)
for (const [n, t] of Object.entries(compFiles)) console.log('  vue', n.padEnd(24), t.split('\n').length)
console.log('exported', exported.size, 'template uses', tplUsed.size)
for (const m of mods.values()) console.log(m.name.padEnd(18), files[m.name].split('\n').length, m.setup ? 'setup' : '')

if (WRITE) {
  fs.mkdirSync(outDir, { recursive: true })
  for (const [n, t] of Object.entries(files)) fs.writeFileSync(path.join(outDir, n + '.ts'), t)
  fs.writeFileSync(path.join(outDir, 'index.ts'), indexTs)
  fs.mkdirSync(compDir, { recursive: true })
  for (const [n, t] of Object.entries(compFiles)) fs.writeFileSync(path.join(compDir, n + '.vue'), t)
  const newApp = [appLines[A.start - 1], appScript, ...appLines.slice(A.end, tStart + 1), tsrc, ...appLines.slice(tEnd)].join('\n')
  fs.writeFileSync(path.join(repo, 'src/App.vue'), newApp)
}
