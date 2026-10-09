import { describe, expect, it } from 'vitest'
import { impactLines, relationsOf } from './replay-relations'

describe('리플레이 카드의 관계 그래프', () => {
  it('설비를 옮겨 소속 방이 바뀌면 hasLocation 의 옛 방이 끊기고 새 방이 이어진다', () => {
    const rels = relationsOf([{ subject: 'ex:dev', removed: ['brick:hasLocation ex:roomA'], added: ['brick:hasLocation ex:roomB'] }])
    expect(rels).toEqual([{ subject: 'ex:dev', predicate: 'hasLocation', gone: ['ex:roomA'], came: ['ex:roomB'] }])
  })

  it('목록 관계(hasPart)는 실제로 빠지고 더해진 대상만 낸다', () => {
    const rels = relationsOf([{ subject: 'ex:L1', removed: ['brick:hasPart ex:a, ex:b, ex:c'], added: ['brick:hasPart ex:a, ex:c, ex:d'] }])
    expect(rels).toEqual([{ subject: 'ex:L1', predicate: 'hasPart', gone: ['ex:b'], came: ['ex:d'] }])
  })

  it('이름·숫자·종류 줄은 관계가 아니고, 주어로 시작하는 첫 줄도 읽는다', () => {
    const rels = relationsOf([
      {
        subject: 'ex:dev',
        removed: ['rdfs:label "옛 이름"', 'ex:areaM2 20.5'],
        added: ['ex:dev a brick:Thermostat', 'rdfs:label "새 이름"', 'ex:areaM2 13.5', 'brick:feeds ex:vav1'],
      },
    ])
    expect(rels).toEqual([{ subject: 'ex:dev', predicate: 'feeds', gone: [], came: ['ex:vav1'] }])
  })

  it('같은 대상을 다시 쓴 줄(순서만 바뀜)은 변화가 아니다', () => {
    expect(relationsOf([{ subject: 'ex:L1', removed: ['brick:hasPart ex:a, ex:b'], added: ['brick:hasPart ex:b, ex:a'] }])).toEqual([])
  })
})

describe('관계 변화의 질의 영향', () => {
  const name = (r: string) => ({ 'ex:dev': 'AHU-1', 'ex:roomA': '대기실', 'ex:roomB': '접수', 'ex:L1': '1F', 'ex:vav1': 'VAV-1', 'ex:b': '회의실' })[r] ?? r
  it('설비를 옮겨 방이 바뀌면 새 방 안의 설비에 들어가고 옛 방에서는 빠진다', () => {
    expect(impactLines([{ subject: 'ex:dev', predicate: 'hasLocation', gone: ['ex:roomA'], came: ['ex:roomB'] }], name)).toEqual([
      '「접수」 안의 설비에 「AHU-1」이 들어가고, 「대기실」 안의 설비에서는 빠진다',
    ])
  })
  it('공급 대상과 구성은 더해지고 빠진 것을 조사를 맞춰 적는다', () => {
    expect(impactLines([{ subject: 'ex:dev', predicate: 'feeds', gone: [], came: ['ex:vav1'] }], name)).toEqual(['「AHU-1」이 공급하는 것에 「VAV-1」이 더해진다'])
    expect(impactLines([{ subject: 'ex:L1', predicate: 'hasPart', gone: ['ex:b'], came: [] }], name)).toEqual(['「1F」의 구성에서 「회의실」이 빠진다'])
  })
  it('새 방에만 들어가면(소속이 없던 설비) 한 마디로 끝난다', () => {
    expect(impactLines([{ subject: 'ex:dev', predicate: 'hasLocation', gone: [], came: ['ex:roomB'] }], name)).toEqual(['「접수」 안의 설비에 「AHU-1」이 들어간다'])
  })
})
