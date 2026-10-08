---
id: "ADR-0015"
title: "플랫폼 프로토타입은 별도 진입점과 층별 브라우저 저장을 사용한다"
status: "제안"
date: "2026-10-08"
deciders: ["Codex"]
prd: ["D-INT", "D1", "U5"]
tickets: ["OE-UI-01", "OE-UI-02", "OE-UI-04", "OE-GEN-02", "OE-WF-01", "OE-WF-18", "OE-WF-19"]
supersedes: []
superseded_by: ""
---

# ADR-0015 플랫폼 프로토타입의 별도 진입점

## 맥락

사용자가 docs/prd의 현재 요구사항을 기반으로 플랫폼 프로토타입을 요청했다.
기존 index.html은 BIM 편집 작업과 기존 e2e의 진입점이다. D-INT와 D1은 열려 있다.
리뷰 중 요구사항을 생산용 구현으로 확정하지 않으면서 전체 사용자 흐름을 검토할 자리가 필요하다.

## 결정

prototype.html을 Vue의 별도 진입점으로 추가한다. IFC 워커·merge·IDF·편집·Three.js·TTL/GeoJSON·검증 모듈을 재사용한다.
층별 반영본·임시 저장본·버전은 localStorage에 두고 DT 미연동 데모임을 화면에 명시한다.
D1 C안은 제안 기준으로만 표시한다. PRD는 수정하지 않는다.

## 고려한 다른 길

- index.html 전체 교체: 기존 편집 UI와 많은 e2e의 진입 흐름을 함께 바꾸게 된다.
- DT API를 새로 구축: D-INT가 결정되기 전에 실제 반영 소재지를 임의로 확정하게 된다.

## 결과

기존 에디터를 유지하면서 사이트부터 내보내기까지 체험할 수 있다.
기획 검토·권한·잠금·공유 저장·생산용 편집 제약의 완료를 의미하지 않는다.
대용량 메시·localStorage 한계는 docs/dev/platform-prototype.md에 남긴다.
되돌리려면 prototype.html, src/platform, 관련 e2e와 Vite 진입점 하나를 제거한다.
