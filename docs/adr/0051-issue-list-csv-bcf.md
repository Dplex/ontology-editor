---
id: "ADR-0051"
title: "BIM 필수 요구를 어긴 요소는 요구사항 보고서와 같은 조건으로 요소마다 뽑아 CSV 와 BCF 2.1 로 내고, BCF 토픽은 (R · 분류 · 규칙 · 층)마다 하나로 그 요소들을 GlobalId 로 고른다"
status: "제안"
date: "2026-10-11"
deciders: ["정희록"]
prd: []
tickets: ["OE-GEN-08", "OE-BIM-20"]
criteria: ["OE-BIM-20#1"]
code: ["src/lib/issue-list.ts", "src/lib/issue-code.ts", "src/lib/export/bcf.ts", "src/lib/zip.ts", "src/lib/requirements.ts", "src/App.vue"]
tests: ["src/lib/issue-list.test.ts", "e2e/reports.spec.ts"]
related: ["ADR-0050"]
---

# ADR-0051 어긴 요소 목록 — CSV · BCF

## 맥락

고객사 결과 리포트(OE-GEN-08)는 R 번호마다 "표준 자리 n / 대상 m" 과 수정 방법까지 말한다. 설계사가 원본 BIM 에서 고치려면
어느 요소인지가 필요한데, 그것이 없다. 우리는 편집기에서 보정하지만 다음 판 BIM 은 같은 것이 빠진 채 온다.

벤치마킹한 Nomic 의 IFC 모델 검사기는 어긴 요소를 요소 ID·층 목록으로 주고 Excel·JSON 으로 내보내며, Autodesk·Bentley 의 이슈로
보낸다. 같은 일을 특정 제품에 묶이지 않게 하는 표준이 BCF(buildingSMART BIM Collaboration Format)다 — 이슈를 열면 그 요소가
골라지고 카메라가 그쪽을 본다. 받는 도구: BIMcollab Zoom 무료판은 IFC 를 열고 BCF 파일을 가져온다(라이선스 없음). Revit·Navisworks 는
라이선스가 필요하고 BCF 를 기본으로 읽지 않아 BCF Manager 플러그인(BIMcollab 등)이 든다. Navisworks 무료판(Freedom)은 IFC 를 못 연다.

## 결정

- **요소는 요구사항 보고서(requirements.ts)가 R 마다 센 조건 그대로 고른다.** 요소로 가를 수 있는 R 은 11개다(R2·R3·R4·R5·R11·R14·R16·
  R21·R22·R23·R24). 단위·좌표계·IFC 버전·GUID 유지·층 이름 맞춤처럼 파일 하나에 대한 R 은 리포트(HTML)에만 둔다. 시험이 R 마다
  목록의 수와 보고서의 "대상 − 표준 자리" 가 같은지 본다(픽스처 7개 + Duplex·병원).
- 완전성 검사(checks.ts)의 어긴 요소도 싣는다. R 은 issue-code.ts 의 표를 쓰고, 요청은 비운다 — 요구사항 줄의 요청(예: R2 의 외곽선)과
  고칠 곳이 다르다. 사람이 더한 요소(added)는 BIM 에 없으니 싣지 않는다. 맞는 R 이 없는 검사(`connection-fluid`·`sprinkler-fp`)는 BIM 요구
  위반이 아니라 에디터가 보정할 검증이라 싣지 않는다 — 화면 칩은 R 대신 "C-보정 · 검증 규칙 ID" 다(OE-BIM-20#1, 2026-10-15 더함).
- 분류(X/A/B/C)는 리포트와 같은 `missingClass` 다. 다른 자리(속성에만 있는 계통·OmniClass, 이름으로만 정한 종류, Proxy)는 A-설정이다.
- **CSV** 는 엑셀이 바로 여는 UTF-8 BOM 이다. 칸: R · 분류 · 규칙 · 무엇이 없나 · GlobalId · Revit 요소 ID(이름 끝 숫자, versions.ts) ·
  이름 · IFC 클래스 · 층 · X · Y · Z · 요청.
- **BCF 2.1** 토픽은 요소마다가 아니라 (R · 분류 · 규칙 · 층)마다 하나다. Duplex 만 해도 어긴 요소가 1,100개를 넘어 요소마다 만들면
  목록이 쓸모없다. 토픽의 보기는 그 요소들을 IfcGuid 로 다 고르고, 카메라는 그 범위를 남서쪽 위에서 내려다본다(IFC 세계 좌표).
  22자 GlobalId 가 아닌 id 는 고를 수 없어 설명에만 적는다. zip 은 라이브러리 없이 STORE 로 쓴다(zip.ts).
- **판정은 편집한 상태로 한다.** 결과 리포트와 같은 모델·판정이라 두 산출물의 수가 같고, 편집기에서 이미 메운 것(소속 지정·종류 등)은
  빠져서 설계사에게는 우리가 아직 못 메운 것만 간다.
- 화면은 리포트 접이칸의 고객사 결과 리포트 옆이다. R·분류·규칙마다 개수 표와 [누락 요소 목록(CSV)]·[누락 요소 BCF] 두 단추.

## 고려한 다른 길

- **xlsx 로 낸다** — 라이브러리가 든다. CSV 를 엑셀이 열고, 거르기·정렬은 엑셀이 한다.
- **요소마다 BCF 토픽** — 고르기 단위로는 정확하지만 수백~수천 개 이슈를 설계사가 하나씩 닫을 수 없다. 묶음 단위가 "무엇을 고치나"
  와 맞는다(같은 R·층은 같은 설정·같은 작업).
- **BCF 3.0** — 받는 도구가 아직 2.1 을 더 많이 읽는다. 2.1 은 buildingSMART 공식 XSD 로 검증했다.
- **연 때의 BIM(baseline)으로 판정** — 원본의 결함을 빠짐없이 돌려줄 수 있지만, 결과 리포트와 수가 달라지고 편집기에서 이미 메운 것까지
  설계사에게 다시 간다. 다음 판에서도 편집 파일이 다시 얹으니(versions.ts) 메운 것은 우리 쪽에서 남는다.

## 결과

- 2026-10-11 측정: Duplex 건축+MEP(합친 순서 화면 그대로) 1,138개 · 토픽 묶음, 병원 건축+HVAC 4,741개. buildingSMART BCF 2.1 XSD 로
  markup·viewpoint·version·project 92파일 전부 통과(lxml). BCF 가 고른 GlobalId 는 Duplex 1,116 · 병원 4,741 이 전부 원본 IFC 에 있다.
  설비의 Revit 요소 ID 는 95% 넘게 이름 끝에서 잡힌다(방은 이름에 없다).
- 받는 도구에서 열어 카메라 자리가 맞는지는 보지 못했다(BIMcollab Zoom 무료판으로 IFC 와 같이 열어 본다). Revit 의 IFC 내보내기
  좌표(공유·내부 원점)에 따라 카메라가 어긋날 수 있다 — 고르기(IfcGuid)는 좌표와 상관없이 맞는다.
