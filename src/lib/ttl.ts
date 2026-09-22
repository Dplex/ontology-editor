// Turtle 문서에서 접두사 선언만 읽어 낸다.
//
// 편집기가 맨 처음 필요로 하는 것이 이것이다. `bldg:Room` 이 실제로 어떤 IRI 인지 모르면
// 화면은 이름을 짧게 줄여 보여줄 수도, 사용자가 친 짧은 이름을 되돌릴 수도 없다.
//
// 삼중항까지 읽는 온전한 파서는 아직 없다. 마침표는 IRI 안에도 문자열 리터럴 안에도
// 나오기 때문에, 줄 단위로 세는 방식은 처음부터 틀린 값을 준다. 파서가 필요해지는 시점에
// rdf-canonize 계열 라이브러리를 붙이고, 그때까지 이 파일은 접두사만 다룬다.

export type Prefix = {
  /** 콜론을 뺀 접두사 이름. 기본 접두사(`@prefix : <...>`)는 빈 문자열이다. */
  name: string
  /** 꺾쇠를 벗긴 IRI. */
  iri: string
}

// Turtle 은 `@prefix ex: <iri> .` 를, SPARQL 문법을 빌린 형태는 `PREFIX ex: <iri>` 를 쓴다.
// 둘 다 실제 파일에서 나오므로 같이 받는다. 대소문자는 구분하지 않는다.
const PREFIX_RE = /^\s*(?:@prefix|PREFIX)\s+([^\s:]*):\s*<([^>]*)>\s*\.?/i

/**
 * 주석(`#`)을 걷어낸다.
 *
 * `#` 은 세 자리에서 주석이 아니다: IRI(`<...>`) 안, 따옴표 문자열 안, 그리고 그 둘을 여는
 * 문자 앞에 놓인 역슬래시 뒤다. 특히 IRI 는 거의 항상 `#` 으로 끝나기 때문에(`...building#`),
 * 이걸 빼먹으면 접두사 선언이 통째로 잘려 나가서 한 줄도 읽히지 않는다.
 */
function stripComment(line: string): string {
  let quote: string | null = null
  let inIri = false

  for (let i = 0; i < line.length; i++) {
    const c = line[i]

    if (quote) {
      if (c === '\\') i++
      else if (c === quote) quote = null
    } else if (inIri) {
      if (c === '>') inIri = false
    } else if (c === '"' || c === "'") {
      quote = c
    } else if (c === '<') {
      inIri = true
    } else if (c === '#') {
      return line.slice(0, i)
    }
  }

  return line
}

/**
 * 접두사 선언을 나온 순서대로 돌려준다.
 *
 * 같은 이름이 두 번 선언되면 뒤에 나온 것이 이긴다. Turtle 명세가 재선언을 허용하고,
 * 그 뒤의 문서는 마지막 선언을 기준으로 읽히기 때문이다.
 */
export function parsePrefixes(text: string): Prefix[] {
  const seen = new Map<string, number>()
  const out: Prefix[] = []

  for (const raw of text.split(/\r?\n/)) {
    const m = PREFIX_RE.exec(stripComment(raw))
    if (!m) continue

    const found: Prefix = { name: m[1], iri: m[2] }
    const at = seen.get(found.name)
    if (at === undefined) {
      seen.set(found.name, out.length)
      out.push(found)
    } else {
      out[at] = found
    }
  }

  return out
}

/**
 * IRI 를 접두사 형태(`ex:Room`)로 줄인다. 줄일 수 없으면 원래 IRI 를 그대로 돌려준다.
 *
 * 가장 긴 IRI 를 가진 접두사를 먼저 본다. 짧은 쪽을 먼저 맞추면 더 구체적인 접두사가
 * 있는데도 엉뚱하게 넓은 쪽으로 줄어든다.
 */
export function shorten(iri: string, prefixes: Prefix[]): string {
  const sorted = [...prefixes].sort((a, b) => b.iri.length - a.iri.length)
  for (const p of sorted) {
    if (p.iri !== '' && iri.startsWith(p.iri)) return `${p.name}:${iri.slice(p.iri.length)}`
  }
  return iri
}
