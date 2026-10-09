import { describe, expect, it } from 'vitest'
import { relationsOf } from './replay-relations'

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
