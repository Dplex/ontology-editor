---
id: "ADR-0011"
title: "층 단위 생성은 층마다 TTL·GeoJSON 두 파일로 export 하고, 층 파일을 모두 합치면 건물 전체 TTL 과 같은 triple 이 되도록 나눈다"
status: "채택"
date: "2026-10-03"
prd: ["#7", "#8"]
tickets: ["OE-GEN-11", "OE-MAN-06"]
supersedes: []
superseded_by: ""
---

# ADR-0011 층 단위 생성은 층마다 TTL·GeoJSON 두 파일로 export 하고, 층 파일을 모두 합치면 건물 전체 TTL 과 같은 triple 이 되도록 나눈다

## 맥락

OE-GEN-11 "층마다 생성·등록 가능", OE-MAN-06 "층 단위로 진행, 층마다 온톨로지 생성". 성수처럼 19층짜리 건물은 층별로 나눠 편집하고 export 한다.
GeoJSON 은 원래 층마다 한 파일이었지만 TTL 은 건물 전체가 한 파일이었다.

층 하나의 TTL 을 export 하려면 여러 층에 걸친 것을 어떻게 할지 정해야 한다. 측정해 보니 층을 넘는 줄이 적지 않다 — 층 파일 하나에서
다른 층 subject 를 가리키는 줄이 병원 건축+HVAC 311 · IDF 225 · ifc4Mep 20(층을 넘는 흐름 `feeds`, 여러 층에 걸친 계통의 구성원,
공조존의 방). 병원 MEP 연결의 29%(13,608 중 3,992)가 층을 넘는다.

선택:

| 질문 | 선택 | 선택하지 않은 것 |
|---|---|---|
| 다른 층을 가리키는 줄 | **id 로 남긴다** | 뺀다(파일 하나로 완결되지만 합쳐도 층을 넘는 연결이 사라진다) · TTL 은 항상 건물 전체 |

## 결정

층 하나를 구축하면 그 층의 `floor-{층}.ttl` 과 `floor-{층}.geojson` 두 파일을 export 한다(`storey-export.ts`). GeoJSON 은 건물 전체로 export 할 때의
해당 층 파일과 같다. TTL 은 해당 층 내용만 export 한다(`ttl.ts` 의 `storeyScope`).

- 층·방·커스텀존·설비 블록은 해당 층 파일에만 들어간다
- 건물 블록은 층 파일마다 두고 `brick:hasPart` 는 해당 층만 가리킨다
- 여러 층에 걸친 계통은 구성원이 있는 층마다 블록을 두고 `brick:hasPart` 를 그 층 구성원으로 제한한다. 클래스·이름 줄은 층마다 같다
- 공조존(IDF)은 해당 층(`storeyId`, GeoJSON 이 그 존을 그리는 층) 파일에 통째로 들어간다
- 다른 층을 가리키는 object(feeds·hasPart)는 id 로 남긴다. id 가 건물 전체와 같다
- 어느 층에도 속하지 않는 것(구성원 없는 계통, 층을 모르는 IDF 설비)은 맨 아래 층 파일에 둔다

그래서 **층 파일을 모두 합치면 건물 전체 TTL 과 triple(subject·predicate·object 한 문장) 단위로 같다.** 수신 측은 층 파일을 받는 대로 쌓으면 되고, 모두 받으면 건물 전체를 받은
것과 같다. 층 파일 하나만 보면 대상이 그 파일에 없는 줄이 생기는데, 그 대상은 모두 다른 층 파일의 subject 다.

건물 전체 TTL(층을 선택하지 않은 것)은 이 결정 전과 바이트 단위로 같다.

## 결과

- `check:sample` "층 단위 생성 (OE-GEN-11)" 이 보유 샘플 BIM 6개(AC20·ifc4Mep·Duplex 건축+HVAC·Duplex MEP·병원 건축+HVAC·IDF)로 확인한다 —
  합친 triple = 전체, 층마다 GeoJSON feature 가 모두 TTL subject 로 있음, 대상이 없는 줄은 모두 다른 층 파일의 subject
- 수신 측이 층 파일 하나만 읽으면 다른 층을 가리키는 줄의 대상이 비어 있다. 층 파일을 쌓아 읽는지는 수신 측에 확인해야 한다(ttl.go 의 동작은 확인하지 않았다)
- 층 파일은 "등록" 이 아니라 다운로드다. DT 서버 등록은 D-INT 가 정해진 뒤에 한다
