---
id: "OE-GEN-06"
epic: "E08"
epic_title: "온톨로지 생성 · 내보내기 · 리포트"
title: "DT 3D Map 생성"
prd: "#8"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
status_note: "D11"
blocked_by: ["D11"]
depends: ["OE-UI-02", "OE-INT-03", "OE-INT-01", "D11"]
---

# OE-GEN-06 DT 3D Map 생성

## 관련 티켓

- [OE-UI-02](../E03-UI/OE-UI-02.md): 운영 편집 모드 전환
- [OE-INT-03](../E20-INT/OE-INT-03.md): 3D 형상 출력 형식·변환 주체
- [OE-INT-01](../E20-INT/OE-INT-01.md): DT 등록 경로 결정

## 요구사항
> User story : 구축 담당자가 한 층의 온톨로지 생성·등록을 마치면 DT가 그 층의 3D 맵을 만들고, 그 층은 초기 구축 모드에서 운영 편집 모드로 넘어간다. 운영 담당자는 구축 직후부터 그 층을 DT 3D 뷰에서 보며 모니터링을 시작하고, 고객사 관리자는 이후 변경을 운영 편집으로 처리한다. 사용자는 생성 직후 3D 뷰에서 물리존·설비가 제자리에 보이는지 확인해 좌표계나 형상 문제를 등록 시점에 잡을 수 있어야 한다. 레이아웃 데이터만으로 DT가 그릴 수 있는지, 추가 형상 출력이 필요한지는 결정 후 반영된다.

생성·등록이 끝나면 DT 가 그 층의 3D Map 을 만든다. 이후 그 층은 운영 편집 모드로 들어간다(OE-UI-02). GeoJSON 만으로 Unity 가 그릴 수 있는지, FBX/glTF/IMDF 출력이 더 필요한지와 변환 주체는 D11(OE-INT-03).

## 수용 기준

D11 결정 후 적는다. 생성한 층이 DT 3D View 에 보인다.

## 검증 (이 repo)

—

## 메모

—
