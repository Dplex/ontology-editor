// 우리가 낸 Brick TTL 을 **받는 쪽처럼** 읽는다. 내보낸 파일 뷰어(viewer.html)와 check:sample 이 쓴다.
//
// 받는 쪽 DT 파서(ieum-pipeline 의 internal/ontology/ttl.go, 2026-09-29 `39d1dca`)는 범용 Turtle 파서가 아니다.
// 마침표로 끝나는 줄까지를 한 블록으로 보고, `ex:X a brick:클래스`(또는 `ex:클래스`)로 시작하는 블록만 주어로 읽으며,
// 술어는 hasPoint·feeds·hasLocation·hasPart 넷과 rdfs:label 만 본다. 그래서 Turtle 로 맞아도 저쪽에서는 사라지는
// 것이 생긴다 — 주어 블록 밖에 따로 적은 feeds(예전에 흐름 연결 1,995개가 전부 사라졌다), `fso:` 클래스인 덕트·배관.
// 이 모듈은 그 규칙을 **옮겨 적은 것**이다. 저쪽 저장소를 빌드하거나 고치지 않고, 이 repo 안에서 같은 결과를 본다.
// 저쪽 규칙이 바뀌면 여기도 바꾼다(문법 자체가 맞는지는 check:sample 이 rdflib 로 따로 본다).

export type OntologyEntity = {
  /** 이스케이프를 푼 지역 이름. GeoJSON feature id 와 같은 문자열이다. */
  key: string
  /** 네임스페이스를 뗀 클래스 이름(`Air_Handling_Unit`). 받는 쪽은 brick: 과 ex: 를 같게 본다. */
  cls: string
  ns: 'brick' | 'ex'
  label: string
  points: string[]
  feeds: string[]
  locations: string[]
  parts: string[]
  /** 파일에 적힌 블록 그대로(앞뒤 공백만 뗀 것). 뷰어가 원문을 보인다. */
  source: string
}

export type TtlReading = {
  entities: OntologyEntity[]
  /** 주어 블록이지만 받는 쪽이 읽지 않는 것(`fso:` 덕트·배관 등). 키와 접두사 붙은 클래스. */
  unread: { key: string; cls: string; source: string }[]
}

const SUBJECT = /^ex:(\S+)\s+a\s+(brick|ex):(\w+)/
const ANY_SUBJECT = /^ex:(\S+)\s+a\s+(\w+:\w+)/
// 문자열 안의 \" 에서 끝나지 않는다(인치 표기 `DN50:3/4"` 가 든 이름).
const LABEL = /rdfs:label\s+"((?:[^"\\]|\\.)*)"/
const REF = /ex:([^\s,;.]+)/g

/** Turtle 의 역슬래시 이스케이프를 푼다. 지역 이름의 `\$`, 문자열의 `\"`·`\\`·`\n`·`\r`·`\t`. */
export function unescapeTurtle(s: string): string {
  if (!s.includes('\\')) return s
  let out = ''
  for (let i = 0; i < s.length; i++) {
    if (s[i] !== '\\' || i + 1 === s.length) {
      out += s[i]
      continue
    }
    const c = s[++i]
    out += c === 'n' ? '\n' : c === 't' ? '\t' : c === 'r' ? '\r' : c
  }
  return out
}

/** 한 술어의 목적어들. 절은 세미콜론으로 나뉘고, 목적어는 전부 `ex:` 다. */
function objects(block: string, predicate: string): string[] {
  const want = `brick:${predicate}`
  const out: string[] = []
  for (const raw of block.split(';')) {
    const clause = raw.trim()
    if (!clause.startsWith(want)) continue
    const rest = clause.slice(want.length)
    // 이름이 더 긴 다른 술어(hasPointX)를 거른다.
    if (rest !== '' && !/^\s/.test(rest)) continue
    for (const m of rest.matchAll(REF)) out.push(unescapeTurtle(m[1].replace(/,$/, '')))
  }
  return out
}

export function readOntologyTTL(text: string): TtlReading {
  const entities: OntologyEntity[] = []
  const unread: TtlReading['unread'] = []
  let block = ''
  const flush = () => {
    const s = block.trim()
    block = ''
    if (!s) return
    const m = SUBJECT.exec(s)
    if (!m) {
      const any = ANY_SUBJECT.exec(s)
      if (any) unread.push({ key: unescapeTurtle(any[1]), cls: any[2], source: s })
      return
    }
    const label = LABEL.exec(s)
    entities.push({
      key: unescapeTurtle(m[1]),
      ns: m[2] as 'brick' | 'ex',
      cls: m[3],
      label: label ? unescapeTurtle(label[1]) : '',
      points: objects(s, 'hasPoint'),
      feeds: objects(s, 'feeds'),
      locations: objects(s, 'hasLocation'),
      parts: objects(s, 'hasPart'),
      source: s,
    })
  }
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim()
    if (line === '' || line.startsWith('@prefix') || line.startsWith('#')) continue
    block += `${line}\n`
    // 마침표로 끝나면 한 주어가 끝났다. 쉼표로 끝난 줄은 목적어 목록이 이어진다.
    if (line.endsWith('.') && !line.endsWith(',')) flush()
  }
  flush()
  return { entities, unread }
}
