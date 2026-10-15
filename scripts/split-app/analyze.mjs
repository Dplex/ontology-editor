// App.vue 스크립트의 최상위 문장을 뽑아 선언·참조·대입·즉시 평가 의존을 JSON 으로 낸다.
import fs from 'node:fs'
import path from 'node:path'
import { createRequire } from 'node:module'
const repo = process.argv[2]
const require = createRequire(path.join(repo, 'package.json'))
const ts = require('typescript')

const src = fs.readFileSync(process.env.ORIG, 'utf8')
const lines = src.split('\n')
const start = lines.findIndex((l) => l.startsWith('<script setup')) + 1
const end = lines.findIndex((l) => l.startsWith('</script>'))
const script = lines.slice(start, end).join('\n')
const fileName = path.join(repo, 'src/__App.ts')
const host = ts.createCompilerHost({ target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, lib: ['lib.es2022.d.ts', 'lib.dom.d.ts', 'lib.dom.iterable.d.ts'] })
const orig = host.getSourceFile
host.getSourceFile = (f, ...a) => (path.resolve(f) === fileName ? ts.createSourceFile(f, script, ts.ScriptTarget.ES2022, true) : orig(f, ...a))
const origRead = host.readFile
host.readFile = (f) => (path.resolve(f) === fileName ? script : origRead(f))
const origExists = host.fileExists
host.fileExists = (f) => path.resolve(f) === fileName || origExists(f)
const program = ts.createProgram([fileName], { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, moduleResolution: ts.ModuleResolutionKind.Bundler, strict: true, skipLibCheck: true, noEmit: true, allowImportingTsExtensions: true, types: [] }, host)
const sf = program.getSourceFile(fileName)
const checker = program.getTypeChecker()

const lineOf = (pos) => sf.getLineAndCharacterOfPosition(pos).line + start + 1 // App.vue 줄 번호(1부터)

// 최상위 선언 심볼 → 이름
const topSyms = new Map() // symbol → { name, stmtIndex, kind }
const stmts = []
sf.statements.forEach((st, i) => {
  const rec = { pos: st.getFullStart(), sPos: st.getStart(sf), endPos: st.getEnd(), i, kind: ts.SyntaxKind[st.kind], line: lineOf(st.getStart(sf)), fullLine: lineOf(st.getFullStart()), endLine: lineOf(st.getEnd()), names: [], isType: false, letNames: [], effect: false, init: null }
  const add = (nameNode, kind) => {
    const sym = checker.getSymbolAtLocation(nameNode)
    if (sym) topSyms.set(sym, { name: nameNode.text, i, kind })
    rec.names.push(nameNode.text)
  }
  if (ts.isImportDeclaration(st)) {
    rec.kind = 'import'; rec.from = st.moduleSpecifier.text; rec.typeOnly = !!(st.importClause && st.importClause.isTypeOnly); rec.specs = []; if (st.importClause?.namedBindings && ts.isNamedImports(st.importClause.namedBindings)) for (const e of st.importClause.namedBindings.elements) rec.specs.push({ name: e.name.text, text: e.getText(sf), type: e.isTypeOnly }); if (st.importClause?.name) rec.specs.push({ name: st.importClause.name.text, text: st.importClause.name.text, def: true })
    const cl = st.importClause
    if (cl) {
      if (cl.name) add(cl.name, 'import')
      if (cl.namedBindings && ts.isNamedImports(cl.namedBindings)) for (const e of cl.namedBindings.elements) add(e.name, 'import')
      if (cl.namedBindings && ts.isNamespaceImport(cl.namedBindings)) add(cl.namedBindings.name, 'import')
    }
  } else if (ts.isFunctionDeclaration(st)) {
    add(st.name, 'function')
  } else if (ts.isTypeAliasDeclaration(st) || ts.isInterfaceDeclaration(st)) {
    add(st.name, 'type'); rec.isType = true
  } else if (ts.isVariableStatement(st)) {
    const isLet = !(st.declarationList.flags & ts.NodeFlags.Const)
    for (const d of st.declarationList.declarations) {
      const visit = (n) => {
        if (ts.isIdentifier(n)) { add(n, isLet ? 'let' : 'const'); if (isLet) rec.letNames.push(n.text) }
        else if (ts.isObjectBindingPattern(n) || ts.isArrayBindingPattern(n)) n.elements.forEach((e) => e.name && visit(e.name))
      }
      visit(d.name)
      if (d.initializer) {
        let c = d.initializer
        while (ts.isAsExpression(c) || ts.isParenthesizedExpression(c) || ts.isSatisfiesExpression?.(c)) c = c.expression
        rec.init = ts.isCallExpression(c) ? c.expression.getText(sf).slice(0, 40) : ts.SyntaxKind[c.kind]
      }
    }
  } else if (ts.isEnumDeclaration(st)) {
    add(st.name, 'enum')
  } else {
    rec.effect = true
  }
  stmts.push(rec)
})

// 참조: 각 문장이 쓰는 최상위 심볼, 대입하는 let, 즉시 평가(함수 몸 밖) 참조
const resolve = (id) => {
  let sym = checker.getSymbolAtLocation(id)
  if (!sym) return null
  if (topSyms.has(sym)) return topSyms.get(sym)
  // 단축 속성 { a } 의 a
  if (ts.isShorthandPropertyAssignment(id.parent)) {
    const vs = checker.getShorthandAssignmentValueSymbol(id.parent)
    if (vs && topSyms.has(vs)) return topSyms.get(vs)
  }
  return null
}
const isAssignTarget = (id) => {
  let n = id
  const p = n.parent
  if (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind >= ts.SyntaxKind.FirstAssignment && p.operatorToken.kind <= ts.SyntaxKind.LastAssignment) return true
  if ((ts.isPrefixUnaryExpression(p) || ts.isPostfixUnaryExpression(p)) && (p.operator === ts.SyntaxKind.PlusPlusToken || p.operator === ts.SyntaxKind.MinusMinusToken)) return true
  // 구조 분해 대입 [a, b] = ...
  if ((ts.isArrayLiteralExpression(p) || ts.isShorthandPropertyAssignment(p)) ) {
    let q = p
    while (q && (ts.isArrayLiteralExpression(q) || ts.isObjectLiteralExpression(q) || ts.isShorthandPropertyAssignment(q) || ts.isPropertyAssignment(q))) {
      if (ts.isBinaryExpression(q.parent) && q.parent.left === q && q.parent.operatorToken.kind === ts.SyntaxKind.EqualsToken) return true
      q = q.parent
    }
  }
  return false
}
const isFnBoundary = (n) => ts.isFunctionExpression(n) || ts.isArrowFunction(n) || ts.isFunctionDeclaration(n) || ts.isMethodDeclaration(n) || ts.isGetAccessor(n) || ts.isSetAccessor(n) || ts.isClassDeclaration(n) || ts.isClassExpression(n)

for (const rec of stmts) {
  const st = sf.statements[rec.i]
  const assignAt = []; const refs = new Map(), assigns = new Set(), eager = new Set(), typeRefs = new Set()
  const walk = (n, inFn, inType) => {
    if (ts.isIdentifier(n)) {
      // 선언 이름 자신은 건너뛴다
      const r = resolve(n)
      if (r && r.i !== rec.i || (r && r.i === rec.i && !isDeclName(n))) {
        if (r.i !== rec.i) {
          const t = inType || isTypePosition(n)
          if (t) typeRefs.add(r.name)
          else refs.set(r.name, (refs.get(r.name) ?? 0) + 1)
          if (!inFn && !t) eager.add(r.name)
        }
        if (isAssignTarget(n)) { assigns.add(r.name); const p = n.parent; if (ts.isBinaryExpression(p) && p.left === n && p.operatorToken.kind === ts.SyntaxKind.EqualsToken) assignAt.push({ name: r.name, start: p.getStart(sf), rStart: p.right.getStart(sf), end: p.getEnd() }); else assignAt.push({ name: r.name, odd: true, start: n.getStart(sf) }) }
      }
      return
    }
    const fn = inFn || (isFnBoundary(n) && n !== st)
    const ty = inType || ts.isTypeNode(n)
    ts.forEachChild(n, (c) => walk(c, fn, ty))
  }
  ts.forEachChild(st, (c) => walk(c, ts.isFunctionDeclaration(st), rec.isType))
  rec.refs = [...refs.keys()]
  rec.typeRefs = [...typeRefs]
  rec.assigns = [...assigns]; rec.assignAt = assignAt
  rec.eager = [...eager]
}
function isDeclName(n) {
  const p = n.parent
  return (p.name === n) && (ts.isVariableDeclaration(p) || ts.isFunctionDeclaration(p) || ts.isTypeAliasDeclaration(p) || ts.isInterfaceDeclaration(p) || ts.isImportSpecifier(p) || ts.isBindingElement(p))
}
function isTypePosition(n) {
  let p = n.parent
  while (p && (ts.isQualifiedName(p) || ts.isPropertyAccessExpression(p) && false)) p = p.parent
  return ts.isTypeReferenceNode(p) || ts.isTypeQueryNode(p) || ts.isExpressionWithTypeArguments(p) && ts.isHeritageClause(p.parent) || ts.isImportTypeNode(p)
}

fs.writeFileSync(process.argv[3], JSON.stringify({ start, end, script, stmts, tpl: collectTemplateLiterals() }, null, 1))
function collectTemplateLiterals(){ const out=[]; const w=(n)=>{ if(ts.isNoSubstitutionTemplateLiteral(n)||ts.isTemplateExpression(n)) out.push([n.getStart(sf), n.getEnd()]); ts.forEachChild(n,w)}; w(sf); return out }
const diags = ts.getPreEmitDiagnostics(program, sf).filter((d) => d.category === ts.DiagnosticCategory.Error)
console.log('statements', stmts.length, 'errors', diags.length)
for (const d of diags.slice(0, 10)) console.log(lineOf(d.start), ts.flattenDiagnosticMessageText(d.messageText, '\n').slice(0, 200))
