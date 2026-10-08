---
id: "OE-INT-02"
epic: "E20"
epic_title: "DT 연동 · 저장 · ID"
title: "산출물 형식"
prd: "1.7"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-review"
blocked_by: []
depends: ["D9", "S8"]
---

# OE-INT-02 산출물 형식

## 요구사항
> User story : 구축 담당자가 생성한 산출물은 GeoJSON(물리존 외곽선·벽·문·창·설비 좌표)과 Brick TTL(계층·소속·연결)로 나뉘고 같은 IfcGlobalId로 이어진다. TTL에 좌표가 들어가면 테스트가 막으므로 의미 정보와 기하 정보가 섞이지 않아, DT 3D 맵은 GeoJSON을, AI Agent는 TTL을 각각 읽어도 같은 ID로 설비를 찾는다. 이 포맷을 유지할지는 D9가 S1~S8로 평가하며, 담당자는 두 파일의 id 집합이 같음을 확인해 누락을 잡는다.

산출물은 GeoJSON(기하: 물리존 외곽선·벽·문·창·설비 좌표)과 Brick TTL(의미: 계층·소속·연결)이며 같은 IfcGlobalId 로 이어진다(S8). TTL 에는 좌표를 넣지 않는다(테스트로 막는다). 이 포맷을 유지할지는 D9 가 S1~S8 로 평가한다.

## 수용 기준

TTL 에 좌표 리터럴이 없고, GeoJSON 과 TTL 의 id 집합이 같다.

## 검증 (이 repo)

—

## 메모

—
