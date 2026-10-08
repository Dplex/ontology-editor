---
id: "OE-EQP-13"
epic: "E12"
epic_title: "설비 배치 · 편집"
title: "설비 추가·삭제·이름 수정 (E7)"
prd: "#13"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: ["OE-EQP-14", "OE-PIP-01", "OE-PIP-02", "OE-PIP"]
---

# OE-EQP-13 설비 추가·삭제·이름 수정 (E7)

## 관련 티켓

- [OE-EQP-14](./OE-EQP-14.md): 추가 설비 종류 지정
- [OE-PIP-01](../E13-PIP/OE-PIP-01.md): 삭제 시 연결 정리
- [OE-PIP-02](../E13-PIP/OE-PIP-02.md): 삭제 시 계통 정리

## 요구사항

설비를 추가·삭제하고 이름을 수정할 수 있다(E7). 추가한 설비는 바닥 높이에 생기고 소속을 찾으며 종류는 미상이다(OE-EQP-14 로 지정).
설비를 지우면 연결·계통 정보도 함께 지워 없는 설비를 가리키는 `feeds`·`hasPart` 가 나가지 않는다(OE-PIP-01·02). 설비 삭제를 다시 되돌리면 삭제 되었던 연결·계통 정보도 전부 복구된다.
이름을 고치면 `rdfs:label` 이 바뀌지만 타입·패밀리 묶음은 BIM 원래 이름 기준으로 유지된다.

## 수용 기준

- 설비를 지운 뒤 TTL 에 그 설비를 가리키는 `feeds`·`hasPart` 가 없다.
- 이름을 고친 설비가 같은 패밀리 일괄 종류 지정에 여전히 포함된다.

## 검증 (이 repo)

- 더한 설비는 바닥 높이에 생기고 소속을 찾고 종류는 모름이다. 모르는 종류로는 더하지 않는다 — `edit.test.ts` "설비 추가·삭제·이름 (E7)", `e2e/edit-structure.spec.ts`, 성수 E-11
- 지우면 붙은 연결과 계통 자리도 빠져 없는 설비를 가리키는 `feeds`·`hasPart` 가 나가지 않는다. 되돌리면 전부 돌아온다 — 같은 describe, `e2e/edit-structure.spec.ts` "BIM 설비를 지우면", 성수 E-13·E-14
- 이름을 고치면 `rdfs:label` 이 바뀌되, 타입·패밀리 종류 묶음은 BIM 이름으로 유지된다 — `edit.test.ts` "이름을 고치면 label 이 바뀌고", 성수 E-15

## 메모

—
