// 이 repo 의 문서(PRD·티켓·ADR·intent.md)를 읽는 MCP 도구 정의. docs-mcp.mjs(문서 챗봇)와 issue-mcp.mjs(/issue)가 같이 쓴다.
// **문서를 고치는 도구는 없다.** 읽을 수 있는 것도 색인에 든 md 뿐이다(경로를 받아도 색인 밖이면 없는 것으로 친다).
import { KINDS, context, define, freshIndex, links, map, read, search } from './docs-index.mjs'

export const DOCS_INSTRUCTIONS = `ontology-editor(BIM → DT 공간 온톨로지 PoC) repo 의 문서를 읽는 도구다. 고치는 도구는 없다.
- 처음이면 docs_map 으로 무엇이 있는지 본다.
- 질문은 docs_search 로 찾고, 걸린 절을 docs_read(path, section) 로 읽어 근거를 확인한 뒤 답한다. 검색 snippet 만으로 답하지 않는다.
- OE-XXX-nn(티켓), ADR-nnnn, R11·K3·D10·Q3·F9·E1 같은 번호는 먼저 docs_ticket 한 번 — 정의(표의 그 줄)·관련 ADR·시험·코드가 같이 온다. 본문에서 언급한 곳까지 필요하면 docs_links.
- 문서 종류: adr(왜 그렇게 만들었나), ticket(기능 요구·수용 기준·검증), prd(PRD_011 본문·열린 결정 questions.md·용어집), intent(바꾸면 안 되는 설계 의도), doc(작업 규칙 CLAUDE.md·docs/dev/ — IFC 함정, 테스트, 배포, 칸반).`

/** 문서 읽는 도구 다섯. root 는 repo 루트. issue-mcp.mjs 도 같은 것을 쓴다. */
export function docsTools(ROOT) {
  let index = null
  const idx = () => (index = freshIndex(ROOT, index))
  return [
  {
    name: 'docs_map',
    description: '문서 지도. 종류별 개수, ADR 목록(번호·제목·상태), 에픽별 티켓 수·상태, PRD_011 목차, 그 밖의 문서. 처음 한 번 부른다.',
    inputSchema: { type: 'object', properties: {} },
    run: () => map(idx()),
  },
  {
    name: 'docs_search',
    description: '문서를 절 단위로 찾는다(한국어 부분일치 + OE-BIM-12·D10·loadBearing 같은 식별자). 결과의 path·section 을 docs_read 로 읽는다.',
    inputSchema: {
      type: 'object',
      properties: {
        query: { type: 'string', description: '찾을 말. 질문 문장 그대로도 된다' },
        kind: { type: 'string', enum: KINDS, description: '종류로 좁힌다(없으면 전부)' },
        limit: { type: 'number', description: '결과 수(기본 8, 최대 20)' },
      },
      required: ['query'],
    },
    run: a => search(idx(), String(a.query || ''), { kind: a.kind, limit: Math.min(20, Math.max(1, Number(a.limit) || 8)) }),
  },
  {
    name: 'docs_read',
    description: '문서를 읽는다. path 는 docs_search 결과의 path 나 OE-BIM-12·ADR-0049 같은 id. section 을 주면 제목에 그 말이 든 절과 그 하위 절만 읽는다. 항상 목차(outline)를 같이 준다.',
    inputSchema: {
      type: 'object',
      properties: {
        path: { type: 'string' },
        section: { type: 'string', description: '절 제목의 일부(예: "수용 기준", "1.7")' },
        max_chars: { type: 'number', description: '최대 글자 수(기본 6000, 최대 20000)' },
      },
      required: ['path'],
    },
    run: a => {
      const i = idx()
      const doc = read(i, a.path, a.section, Math.min(20000, Math.max(500, Number(a.max_chars) || 6000)))
      if (doc) return doc
      // R11 · K3 · D10 처럼 문서가 아니라 표의 한 줄로 정의된 번호
      const defs = define(i, a.path)
      return defs.length ? { ref: a.path, defs } : { error: `${a.path} 는 색인에 없다. docs_search 로 찾는다` }
    },
  },
  {
    name: 'docs_ticket',
    description: '티켓(OE-XXX-nn) · ADR(ADR-nnnn) · 번호(R11·K3·D10·F9·E1) 하나의 맥락을 한 번에. 티켓이면 요구사항, 수용 기준마다 그것을 재는 시험, depends 가 가리키는 것의 제목·정의 줄, 이 티켓을 다룬 ADR, 이 ID 를 적은 코드, 이 티켓을 depends 로 가리키는 티켓. ADR 이면 본문·티켓 제목·코드. 번호면 정의된 표 줄과 쓰는 티켓·ADR.',
    inputSchema: { type: 'object', properties: { id: { type: 'string' } }, required: ['id'] },
    run: a => context(idx(), String(a.id || '').trim()) ?? { error: `${a.id} 가 없다. docs_search 로 찾는다` },
  },
  {
    name: 'docs_links',
    description: 'OE-BIM-12 · ADR-0049 · D10 · Q3 같은 식별자가 어느 문서의 어느 절, 몇째 줄에서 언급되나(frontmatter 의 depends·blocked_by·tickets·prd 포함).',
    inputSchema: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] },
    run: a => ({ ref: a.ref, mentions: links(idx(), a.ref) }),
  },
]
}
