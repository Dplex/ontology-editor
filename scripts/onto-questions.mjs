// 온톨로지 질문 시험대의 질문(ADR-0050). DT 화면이 온톨로지에 묻는 것(docs/ontology.md "왜 있나", 피처 F1~F16)을
// 건물마다 구체적인 대상으로 바꿔 묻고, 정해진 triple 패턴(onto-graph.mjs query)으로 답을 낸다.
// 같은 패턴을 받는 쪽 보기에도 돌려 "받는 쪽 DT 에서도 답이 나오나" 를 가른다. 질문 글은 gemini 채점(onto-bench.mjs --ask)에 그대로 쓴다.
//
// 질문 하나: { id, f, use, pick(g) → 대상 | null, text(대상), q(대상) → query 인자, answer(rows, g) → 기대 답, kind }
//   pick 이 null 이면 그 건물 BIM 에 그런 대상이 없다(예: 흐름 방향이 없는 Duplex 의 담당 공간).
//   kind: list(이름 목록) · count(수) · value(값 하나) · none(TTL 밖 — 온톨로지에 없다고 답해야 맞다)

const label = (g, id) => g.labels.get(id) ?? ''
const cls = (g, id) => g.classes.get(id) ?? ''
const out = (g, id, p) => (g.byS.get(id) ?? []).filter((t) => t.p === p)
const inn = (g, id, p) => (g.byO.get(id) ?? []).filter((t) => t.p === p)
const lit = (s) => `"${String(s).replace(/"/g, '\\"')}"`

/** 이름이 건물 안에서 하나뿐인가(질문이 한 대상을 가리키게). */
function unique(g) {
  const n = new Map()
  for (const l of g.labels.values()) n.set(l, (n.get(l) ?? 0) + 1)
  return (id) => {
    const l = label(g, id)
    return !!l && n.get(l) === 1
  }
}
const floors = (g) => [...g.classes].filter(([, c]) => c === 'brick:Floor').map(([id]) => id)
/** 물리존: 층의 hasPart 로 달린 것. */
const spaces = (g) => floors(g).flatMap((f) => out(g, f, 'brick:hasPart').map((t) => t.o))
const isDevice = (g, id) => {
  const c = cls(g, id)
  return c.startsWith('brick:') && !['brick:Building', 'brick:Floor'].includes(c) && !c.endsWith('_System') && !spaces(g).includes(id)
}
const devices = (g) => [...g.classes.keys()].filter((id) => cls(g, id).startsWith('brick:') && out(g, id, 'brick:hasLocation').length && isDevice(g, id))

export const QUESTIONS = [
  {
    id: 'Q1', f: 'F1', use: '탐색기 트리', kind: 'list',
    pick: (g) => (floors(g).length ? {} : null),
    text: () => '이 건물의 층마다 물리존(방)이 몇 개씩 있어?',
    q: () => ({ patterns: [['?f', 'a', 'brick:Floor'], ['?f', 'brick:hasPart', '?s']], select: ['f', 's'], limit: 500 }),
    answer: (rows, g) => [...new Set(rows.map(([f]) => label(g, f)))].filter(Boolean),
  },
  {
    id: 'Q2', f: 'F1', use: '탐색기 트리', kind: 'value',
    pick: (g) => {
      const u = unique(g)
      const s = spaces(g).filter(u).sort()[0]
      return s ? { space: s } : null
    },
    text: (p, g) => `${label(g, p.space)} 은(는) 몇 층에 있어?`,
    q: (p, g) => ({ patterns: [['?r', 'rdfs:label', lit(label(g, p.space))], ['?f', 'brick:hasPart', '?r'], ['?f', 'a', 'brick:Floor']], select: ['f'] }),
    answer: (rows, g) => rows.map(([f]) => label(g, f)),
  },
  {
    id: 'Q3', f: 'F11', use: '이상 알림 — 이 설비는 어디에', kind: 'value',
    pick: (g) => {
      const u = unique(g)
      const room = new Set(spaces(g))
      const d = devices(g).filter((id) => u(id) && out(g, id, 'brick:hasLocation').some((t) => room.has(t.o))).sort()
      // 공조기가 있으면 공조기(운영자가 가장 자주 찾는다), 없으면 아무 설비
      const ahu = d.find((id) => /Air_Handling|Fan_Coil|Pump|Boiler|Chiller/.test(cls(g, id)))
      return d.length ? { device: ahu ?? d[0] } : null
    },
    text: (p, g) => `${label(g, p.device)} 은(는) 어느 방에 있어?`,
    q: (p, g) => ({ patterns: [['?e', 'rdfs:label', lit(label(g, p.device))], ['?e', 'brick:hasLocation', '?r']], select: ['r'] }),
    answer: (rows, g) => rows.map(([r]) => label(g, r)),
  },
  {
    id: 'Q4', f: 'F11', use: '3D 맵 — 이 방의 설비', kind: 'list',
    pick: (g) => {
      const u = unique(g)
      const best = spaces(g).filter(u).map((s) => [s, inn(g, s, 'brick:hasLocation').filter((t) => isDevice(g, t.s)).length]).filter(([, n]) => n >= 2 && n <= 15).sort((a, b) => b[1] - a[1])[0]
      return best ? { space: best[0] } : null
    },
    text: (p, g) => `${label(g, p.space)} 에 있는 설비를 알려줘 (덕트·배관 말고)`,
    q: (p, g) => ({ patterns: [['?r', 'rdfs:label', lit(label(g, p.space))], ['?e', 'brick:hasLocation', '?r'], ['?e', 'a', '?c']], filters: [{ var: 'c', contains: 'brick:' }], select: ['e'], limit: 100 }),
    answer: (rows, g) => rows.map(([e]) => e).filter((e) => isDevice(g, e)).map((e) => label(g, e)),
  },
  {
    id: 'Q5', f: 'F8', use: '설비 현황', kind: 'count',
    pick: (g) => {
      const n = new Map()
      for (const id of devices(g)) n.set(cls(g, id), (n.get(cls(g, id)) ?? 0) + 1)
      const top = [...n].sort((a, b) => b[1] - a[1])[0]
      return top ? { cls: top[0] } : null
    },
    text: (p) => `${p.cls.replace('brick:', '')} 는 건물에 몇 개야?`,
    q: (p) => ({ patterns: [['?e', 'a', p.cls]], count: true }),
    answer: (count) => [String(count)],
  },
  {
    id: 'Q6', f: 'F10', use: '계통도 — 계통의 설비', kind: 'count',
    pick: (g) => {
      const u = unique(g)
      const s = [...g.classes].filter(([id, c]) => c.endsWith('_System') && u(id) && out(g, id, 'brick:hasPart').length).map(([id]) => id).sort((a, b) => out(g, b, 'brick:hasPart').length - out(g, a, 'brick:hasPart').length)[0]
      return s ? { system: s } : null
    },
    text: (p, g) => `${label(g, p.system)} 계통에 속한 것은 몇 개야?`,
    q: (p, g) => ({ patterns: [['?s', 'rdfs:label', lit(label(g, p.system))], ['?s', 'brick:hasPart', '?e']], count: true }),
    answer: (count) => [String(count)],
  },
  {
    id: 'Q7', f: 'F16', use: '이상 알림 — 원인(상류)', kind: 'list',
    pick: (g) => {
      const u = unique(g)
      const d = devices(g).filter((id) => u(id) && inn(g, id, 'brick:feeds').some((t) => isDevice(g, t.s))).sort()[0]
      return d ? { device: d } : null
    },
    text: (p, g) => `${label(g, p.device)} 에 공기나 물을 보내는 상류 설비는?`,
    q: (p, g) => ({ patterns: [['?d', 'rdfs:label', lit(label(g, p.device))], ['?u', 'brick:feeds', '?d']], select: ['u'] }),
    answer: (rows, g) => rows.map(([u]) => u).filter((u) => isDevice(g, u)).map((u) => label(g, u)),
  },
  {
    id: 'Q8', f: 'F16', use: '계통도 — 담당 공간', kind: 'list',
    pick: (g) => {
      const u = unique(g)
      const room = new Set(spaces(g))
      const d = devices(g).filter((id) => u(id) && out(g, id, 'brick:feeds').some((t) => room.has(t.o))).sort()[0]
      return d ? { device: d } : null
    },
    text: (p, g) => `${label(g, p.device)} 가 담당하는(공기를 보내는) 방은?`,
    q: (p, g) => ({ patterns: [['?a', 'rdfs:label', lit(label(g, p.device))], ['?a', 'brick:feeds', '?r'], ['?f', 'brick:hasPart', '?r'], ['?f', 'a', 'brick:Floor']], select: ['r'], limit: 200 }),
    answer: (rows, g) => rows.map(([r]) => label(g, r)),
  },
  {
    id: 'Q9', f: 'F2', use: '3D 맵 — 방 정보', kind: 'value',
    pick: (g) => {
      const u = unique(g)
      const s = spaces(g).filter((id) => u(id) && out(g, id, 'ex:areaM2').length).sort()[0]
      return s ? { space: s } : null
    },
    text: (p, g) => `${label(g, p.space)} 의 면적은 몇 ㎡야?`,
    q: (p, g) => ({ patterns: [['?r', 'rdfs:label', lit(label(g, p.space))], ['?r', 'ex:areaM2', '?a']], select: ['a'] }),
    answer: (rows) => rows.map(([a]) => String(a)),
  },
  {
    id: 'Q10', f: 'F3', use: '운영자 호칭 — 방번호', kind: 'value',
    pick: (g) => {
      const nums = new Map()
      for (const t of g.byP.get('ex:roomNumber') ?? []) nums.set(String(t.o), [...(nums.get(String(t.o)) ?? []), t.s])
      const one = [...nums].filter(([, ids]) => ids.length === 1).sort((a, b) => a[0].localeCompare(b[0]))[0]
      return one ? { number: one[0], space: one[1][0] } : null
    },
    text: (p) => `${p.number}호는 어느 층의 무슨 방이야?`,
    q: (p) => ({ patterns: [['?r', 'ex:roomNumber', lit(p.number)], ['?f', 'brick:hasPart', '?r'], ['?f', 'a', 'brick:Floor']], select: ['r', 'f'] }),
    answer: (rows, g) => rows.flatMap(([r, f]) => [label(g, r), label(g, f)]),
  },
  {
    id: 'Q11', f: 'F13', use: 'AI Agent — 방의 센서·관제점', kind: 'list',
    pick: (g) => {
      const u = unique(g)
      const room = new Set(spaces(g))
      const s = [...g.classes].filter(([id, c]) => /Sensor/.test(c) && out(g, id, 'brick:hasLocation').some((t) => room.has(t.o)))
        .map(([id]) => out(g, id, 'brick:hasLocation').find((t) => room.has(t.o)).o).filter(u).sort()[0]
      return s ? { space: s } : null
    },
    text: (p, g) => `${label(g, p.space)} 에 있는 센서는?`,
    q: (p, g) => ({ patterns: [['?r', 'rdfs:label', lit(label(g, p.space))], ['?s', 'brick:hasLocation', '?r'], ['?s', 'a', '?c']], filters: [{ var: 'c', contains: 'Sensor' }], select: ['s'] }),
    answer: (rows, g) => rows.map(([s]) => label(g, s)),
  },
  {
    id: 'Q12', f: 'F15', use: '로봇 관제 — 지나갈 수 있나', kind: 'none',
    pick: (g) => {
      const u = unique(g)
      const s = spaces(g).filter(u).sort()
      return s.length >= 2 ? { a: s[0], b: s[1] } : null
    },
    text: (p, g) => `로봇이 ${label(g, p.a)} 에서 ${label(g, p.b)} 로 문을 지나 갈 수 있어?`,
    // 문·방-문-방 연결은 TTL 에 없다(GeoJSON 의 door feature · connects). 답이 없다고 말해야 맞다.
    q: () => null,
    answer: () => [],
  },
]

export { label as labelOf }
