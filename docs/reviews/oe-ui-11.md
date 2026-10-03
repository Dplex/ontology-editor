OE-UI-11 평면도 뷰 — 평면도 선택과 패널이 맞는지 확인, 벽 선택 수정

Closes #?? (OE-UI-11 — PRD 표 순서로는 #67 또는 #68, PR 올릴 때 확인)
Branch: feature/OE-UI-11-floor-plan
Ticket: docs/prd/features/E03-UI/OE-UI-11.md
Review: docs/reviews/oe-ui-11.md
PRD: prd-review — 요구사항이 바뀌면 다시 본다

## 구현한 것
평면도(`FloorPlan.vue`)는 이미 있었다. 테스트는 방 2개짜리 fixture 뿐이라, 병원·Duplex 건축으로 요구사항 줄마다 확인해 보니 두 가지가 빠져 있었다.

| 요구사항·수용 기준 | 전 | 지금 | 확인 테스트 |
|---|---|---|---|
| 방 외곽선·이름 | 그린다 | 그대로 | 병원 1층 방 154개·2층 106개가 다 그려진다. 전체를 보면 작은 방 이름은 생략하고, 확대하면 더 표시하며, 선택한 방 이름은 항상 표시한다 |
| 벽, **내력벽 진하게** | 내력벽을 어두운 회색(`#39424e`)으로 고정해 둬서 **다크 테마에서 배경에 묻혔다** — 배경 대비 1.54, 일반 벽 2.63 보다 흐렸다 | 글자색(`--fg`)으로 칠한다. 대비 라이트 10.59 · 다크 10.21(일반 벽 2.14 · 2.63) | Duplex 기초 층(T/FDN) 벽 7개가 전부 내력벽, 1층은 0개. 두 테마 모두 내력벽 대비가 일반 벽의 1.5배를 넘는다. 예전 색으로 돌리면 이 테스트가 깨진다(확인함) |
| 기기 위치 | 그린다 | 그대로 | 병원 2층 설비 점을 누르면 패널 제목이 그 점의 이름과 같다 |
| 꼭짓점 끌어 편집 | 된다 | 그대로 | 기존 `floor-plan.spec.ts` 첫 테스트 |
| **평면도 선택 ↔ 오른쪽 패널** — 방·설비 | 평면도 → 패널은 동작했다 | 양방향 모두 확인한다 | 방을 누르면 패널이 그 방 · 다시 누르면 해제되고 패널이 닫힘 · 패널 [선택 해제] 가 평면도 선택도 해제 · **목록에서 다른 층 설비를 선택하면 평면도가 그 층으로 바뀌고 점이 선택됨** |
| **〃 — 벽** | 3D 에서 선택한 벽이 패널에 떠도 평면도에는 표시가 없었고, 평면도에서 벽을 선택할 수 없었다 | 선택한 벽을 강조색으로 그린다. 편집 모드에서 [벽·문·창] 을 켜면(3D 와 같은 조건) 벽을 눌러 선택한다. 방향키로 옮기면 평면도의 벽도 따라 다시 그려진다. 방을 누르면 벽 선택은 해제된다 | Duplex 1층: 보기 모드에서는 벽을 눌러도 선택 안 됨 → 켜면 선택되고 패널에 뜸 → 방향키 → 3D 에 다녀와도 그대로 → 방을 누르면 해제 |

아래 안내 줄도 벽을 선택했을 때와 [벽·문·창] 을 켰을 때를 따로 표시한다(전에는 설비 안내가 떴다). 평면도에는 문·창을 그리지 않으므로 "벽 클릭" 으로,
3D 에서는 "벽·문·창 클릭" 으로 표시한다.

저장 위치: 화면에만 있다. 선택 상태는 3D·평면도·패널이 같은 값(`selectedId`·`selectedSpaceId`·`selectedElementId`)을 공유한다.
평면도에서 한 편집(꼭짓점·벽 옮기기)은 3D 에서 한 편집과 같은 방식으로 모델을 고친다.

## 화면
병원 건축+HVAC 1층. 평면도에서 화장실을 누르면 오른쪽 패널이 그 방이다.
![방 선택](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-UI-11-floor-plan/docs/figures/oe-ui-11-room.png?raw=true)

설비 점을 누르면 패널이 그 설비다.
![설비 선택](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-UI-11-floor-plan/docs/figures/oe-ui-11-device.png?raw=true)

Duplex 기초 층, 다크 테마. 내력벽 7개가 배경에서 뚜렷하다(전에는 거의 보이지 않았다).
![다크 내력벽](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-UI-11-floor-plan/docs/figures/oe-ui-11-bearing-dark.png?raw=true)

Duplex 1층, [벽·문·창] 을 켜고 평면도에서 외벽을 선택한 화면. 패널에 그 벽이 뜨고 아래 안내에 방향키 사용법이 나온다.
![벽 선택](https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/feature/OE-UI-11-floor-plan/docs/figures/oe-ui-11-wall.png?raw=true)

## 확인 방법
1. 8087 검토 서버(또는 `npm run dev`)에서 `data/NBU_MedicalClinic/NBU_MedicalClinic_Arch.ifc` 를 연다
2. 층을 "First Floor만" → [평면도]. 방을 누르면 오른쪽 패널이 그 방, 한 번 더 누르면 해제된다
3. 검색 칸에 2층 설비 이름을 입력하고 목록에서 선택한다 → 평면도가 "Second Floor만" 으로 바뀌고 그 점이 파랗다
4. `data/NBU_Duplex/NBU_Duplex-Apt_Arch.ifc` 를 열고 "T/FDN만" → [다크] — 내력벽이 밝게 보인다
5. "Level 1만" → [3D] → [편집] → [벽·문·창] → [평면도] → 벽을 누른다 → 패널에 그 벽, `→` 로 10cm 옮겨진다

## 테스트
- `npm test` — 40 files · 647 passed
- `npx vue-tsc --noEmit` 통과
- e2e — 106 passed(새로 넣은 것: `floor-plan.spec.ts` "병원 건축: …", "Duplex 건축: …". 파일이 없으면 건너뛴다)
- mutation test — 이 커밋이 넣은 규칙을 하나씩 꺼 보고 테스트가 깨지는지 확인했다. 5곳 중 4곳을 잡았고, 나머지를 잡으려고 추가한 것: `floor-plan.spec.ts` Duplex 테스트에 한 단계 — 편집 모드여도 [벽·문·창] 을 켜기 전에는 평면도에서 벽이 선택되지 않는다

## 남은 것
- 이슈 번호를 확실히 모른다(PRD 표 순서로 #67 또는 #68). PR 올릴 때 맞춘다
- 편집 도구 줄([벽·문·창] 단추 등)은 3D 에만 있다. 평면도에서 벽을 고르려면 3D 에서 켜고 온다 — 켠 것은 탭을 바꿔도 그대로다
- 평면도에는 문·창을 그리지 않는다. 요구사항에 없어서 넣지 않았다
- 성수는 이 PC 에 없어 측정하지 못했다. 이름표 겹침(성수 19개 층 67쌍)은 `FloorPlan.vue` 주석에만 기록돼 있고, 성수 화면 테스트(`e2e-seongsu`)에는 평면도 항목이 없다
