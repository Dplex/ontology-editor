---
id: "OE-MAN-01"
epic: "E07"
epic_title: "초기 구축 — 수동 구축"
title: "배경 위 수동 작성"
prd: "#7"
release: "R2"
priority: "P2"
owner: "tbd"
status: "prd-done"
status_note: "\"빈 층 시작\" 미확인"
blocked_by: []
depends: ["OE-MAN-02", "OE-IDF-09", "OE-SPC", "OE-SPC-02", "OE-SPC-03", "OE-SPC-12", "OE-SPC-13"]
---

# OE-MAN-01 배경 위 수동 작성

## 관련 티켓

- [OE-MAN-02](./OE-MAN-02.md): 평면도 이미지 배경
- [OE-IDF-09](../E04-IDF/OE-IDF-09.md): IDF 참조선 배경
- [OE-SPC-02](../E09-SPC/OE-SPC-02.md): 물리존 생성·분할·병합 도구
- [OE-SPC-03](../E09-SPC/OE-SPC-03.md): 물리존 외곽선 수정 도구
- [OE-SPC-12](../E09-SPC/OE-SPC-12.md): 벽 작성 도구
- [OE-SPC-13](../E09-SPC/OE-SPC-13.md): 문·창 작성 도구

## 요구사항
> User story : R2에서 구축 담당자가 IDF도 BIM도 없는 소형 사이트(SR 등)를 구축할 때, 3D 스캔 모델이나 빈 층을 배경으로 운영 편집과 같은 공간 편집 도구로 물리존·룸·벽·문·창을 직접 그린다. 평면도 이미지가 있으면 배경으로 깔고, IDF 참조선이 있으면 그것을 따른다. 도구가 운영 편집과 같아 따로 배울 필요가 없고, 빈 층에 물리존 하나만 그려 내보내도 GeoJSON·TTL에 나가므로 작은 사이트도 DT 등록이 가능해진다.

R2 요구사항 : IDF·BIM 이 없는 사이트(예: SR)는 3D 스캔 모델 또는 빈 층을 배경으로 물리존·룸·벽·문·창을 수동으로 만든다(PRD 1.6). 도구는 운영 편집의 공간 편집 도구(E09)와 같다. 배경이 평면도 이미지면 OE-MAN-02, IDF 참조선이면 OE-IDF-09 를 따른다.

## 수용 기준

R2 요구사항 : 빈 층에서 물리존 1개를 그리고 내보내면 GeoJSON·TTL 에 그 물리존이 나간다.

## 검증 (이 repo)

—

## 메모

—
