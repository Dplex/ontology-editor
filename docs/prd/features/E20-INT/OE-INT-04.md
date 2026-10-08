---
id: "OE-INT-04"
epic: "E20"
epic_title: "DT 연동 · 저장 · ID"
title: "좌표계·단위"
prd: "1.7"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["OE-BIM-11", "OE-BIM-22", "P4"]
---

# OE-INT-04 좌표계·단위

## 관련 티켓

- [OE-BIM-11](../E05-BIM/OE-BIM-11.md): 임포트 단위 환산
- [OE-BIM-22](../E05-BIM/OE-BIM-22.md): 임포트 좌표 정합

## 요구사항
> User story : 구축 담당자가 에디터에서 센서를 특정 자리에 놓고 등록하면 DT 3D View에서 정확히 같은 자리에 보여야 운영 담당자가 혼란 없이 쓴다. 에디터와 DT(Unity)가 같은 원점·축·단위(m)를 쓰고, 3D 스캔·BIM(R2부터 IDF)의 좌표계 정합은 임포트 단계에서 미리 맞추므로 등록 후 위치가 어긋나는 일이 없다. 기준점을 누가 정의하는지는 P4에서 협의한다. 좌표계가 일치하면 에디터의 치수 표시와 DT의 거리 측정 결과도 같아 운영 담당자가 두 화면의 수치를 교차 확인할 때 환산이나 보정이 필요 없다.

에디터와 DT(Unity)는 같은 원점·축·단위(m)를 쓴다. 3D 스캔·BIM(R2 부터 IDF)의 좌표계 정합은 임포트 단계에서 맞춘다(OE-BIM-11·22). 기준점 정의 주체는 P4.

## 수용 기준

에디터에서 놓은 설비의 좌표가 DT 3D View 의 같은 자리에 보인다.

## 검증 (이 repo)

—

## 메모

—
