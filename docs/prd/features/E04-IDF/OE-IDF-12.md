---
id: "OE-IDF-12"
epic: "E04"
epic_title: "초기 구축 — IDF 임포트"
title: "임시 저장본 저장"
prd: "#5"
release: "R2"
priority: "P1"
owner: "tbd"
status: "prd-done"
status_note: "편집 파일로 대체"
blocked_by: []
depends: ["OE-WF-06"]
---

# OE-IDF-12 임시 저장본 저장

## 관련 티켓

- [OE-WF-06](../E14-WF/OE-WF-06.md): IDF 임포트 임시 저장본

## 요구사항

### User story

R2에서 구축 담당자가 IDF를 임포트해 공조존·설비·담당 관계를 만들고 검토·보정하는 동안, 결과가 OE-WF-06 규칙대로 임시 저장본(편집 파일)으로 보관된다. 에디터를 닫았다 열어도 임포트 결과와 보정이 유지되어 IDF를 다시 파싱하거나 매칭 확인을 반복하지 않고, 보정 완료 후 온톨로지를 생성한다. 임시 저장본은 DT에 반영되지 않아 검토가 끝나지 않은 공조존이 운영 환경에 노출되지 않으며, 보정 완료 후 생성하는 온톨로지만이 운영 DT와 AI Agent에 전달된다.

OE-WF-06 을 따른다. (IDF 임포트)

## 수용 기준

OE-WF-06 의 수용 기준을 따른다.

## 검증 (이 repo)

—

## 메모

—
