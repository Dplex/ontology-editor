import { describe, expect, it } from 'vitest'
import { parsePrefixes, shorten } from './ttl'

describe('parsePrefixes', () => {
  it('@prefix 와 PREFIX 를 둘 다 읽는다', () => {
    const ttl = [
      '@prefix rdf: <http://www.w3.org/1999/02/22-rdf-syntax-ns#> .',
      'PREFIX bldg: <https://ieum.example/building#>',
    ].join('\n')

    expect(parsePrefixes(ttl)).toEqual([
      { name: 'rdf', iri: 'http://www.w3.org/1999/02/22-rdf-syntax-ns#' },
      { name: 'bldg', iri: 'https://ieum.example/building#' },
    ])
  })

  it('기본 접두사는 이름이 빈 문자열이다', () => {
    expect(parsePrefixes('@prefix : <https://ieum.example/> .')).toEqual([
      { name: '', iri: 'https://ieum.example/' },
    ])
  })

  it('주석 안의 선언은 읽지 않는다', () => {
    expect(parsePrefixes('# @prefix dead: <https://ieum.example/dead#> .')).toEqual([])
  })

  // IRI 는 거의 항상 # 으로 끝난다. 이걸 주석으로 보면 선언이 한 줄도 안 읽힌다.
  it('IRI 안의 # 은 주석이 아니다', () => {
    const ttl = '@prefix ex: <https://ieum.example/a#b> . # 진짜 주석'
    expect(parsePrefixes(ttl)).toEqual([{ name: 'ex', iri: 'https://ieum.example/a#b' }])
  })

  it('문자열 리터럴 안의 # 도 주석이 아니다', () => {
    const ttl = [
      'bldg:Room-101 rdfs:label "101호 # 회의실" .',
      '@prefix ex: <https://ieum.example/> .',
    ].join('\n')
    expect(parsePrefixes(ttl)).toEqual([{ name: 'ex', iri: 'https://ieum.example/' }])
  })

  it('재선언은 뒤에 나온 것이 이기고, 자리는 처음 자리를 지킨다', () => {
    const ttl = [
      '@prefix ex: <https://old.example/> .',
      '@prefix other: <https://other.example/> .',
      '@prefix ex: <https://new.example/> .',
    ].join('\n')

    expect(parsePrefixes(ttl)).toEqual([
      { name: 'ex', iri: 'https://new.example/' },
      { name: 'other', iri: 'https://other.example/' },
    ])
  })
})

describe('shorten', () => {
  const prefixes = [
    { name: 'ex', iri: 'https://ieum.example/' },
    { name: 'bldg', iri: 'https://ieum.example/building#' },
  ]

  it('가장 긴 접두사를 먼저 맞춘다', () => {
    expect(shorten('https://ieum.example/building#Room', prefixes)).toBe('bldg:Room')
  })

  it('맞는 접두사가 없으면 그대로 둔다', () => {
    expect(shorten('https://elsewhere.example/Room', prefixes)).toBe(
      'https://elsewhere.example/Room',
    )
  })
})
