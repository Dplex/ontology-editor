---
id: "OE-IDF-02"
epic: "E04"
epic_title: "초기 구축 — IDF 임포트"
title: "HVAC 객체 → 설비·담당"
prd: "#5"
release: "R1"
priority: "P1"
owner: "tbd"
status: "prd-done"
blocked_by: []
depends: []
---

# OE-IDF-02 HVAC 객체 → 설비·담당

## 요구사항

IDF 의 HVAC 객체를 설비와 담당 관계로 만든다. AirLoopHVAC 는 공조기, ZoneHVAC:* 는 존 설비, AirTerminal:* 는 토출구로 읽고 종류·용량·담당 공조존을 둔다.
담당 관계는 존 설비 목록 → 말단 → 급기 분기 → 공조기 순으로, VRF 는 실외기 → 실내기 순으로 잇는다. 설비 위치는 IDF 에 없으므로 좌표 없이 만든다(OE-IDF-08 로 BIM 설비와 연결).

상세 HVAC 객체가 포함된 EnergyPlus IDF에서 설비와 공조 공급·담당 관계를 생성한다. 객체의 종류와 연결 정보를 해석하며, 다음 기준으로 설비를 구분한다.
- AirLoopHVAC는 중앙 공기 계통으로 읽고, 공조기 대표 객체로 생성한다. 실제 공조기와의 동일성은 BIM 설비 연결 단계(OE-IDF-08)에서 확인한다.
- AirTerminal:*는 VAV 등 공기 말단 장치로 읽는다. 객체의 세부 종류에 따라 분류하며, 일괄적으로 토출구로 분류하지 않는다.
- ZoneHVAC:*는 실제 존 설비, 관계 정보, 가상 장치를 구분한다. EquipmentList·EquipmentConnections는 관계 해석에 사용하고 설비로 생성하지 않는다. AirDistributionUnit은 참조하는 말단 장치로 연결하며 중복 설비를 생성하지 않는다. IdealLoadsAirSystem은 가상 장치이므로 실제 설비에서 제외한다.
- VRF는 AirConditioner:VariableRefrigerantFlow를 실외기, ZoneHVAC:TerminalUnit:VariableRefrigerantFlow를 실내기로 읽는다. 지원하는 추가 객체 유형과 버전은 명시하며, 미지원 유형은 검토 항목으로 표시한다.

공조 공급·담당 관계는 객체 이름 참조와 입출구 노드 연결을 따라 생성한다. 중앙 공기 계통은 존 연결 정보 → 존 설비 목록 → 말단 장치 → 급기 분기·공급 경로 → 중앙 공기 계통을 추적하여, 공조기 대표 객체 → 말단 장치 → 담당 공조존 관계로 만든다. VRF는 실외기 → ZoneTerminalUnitList → 실내기 → 담당 공조존을 연결한다. 참조가 없거나 연결을 해석할 수 없으면 관계를 임의로 만들지 않고 미연결 사유를 표시한다.

설비에는 원본 객체 유형·이름, 설비 종류, 담당 공조존을 저장한다. 성능 정보는 냉방 용량·난방 용량(W)과 설계 풍량(m³/s)을 구분하고, 필요하면 참조하는 코일 등 하위 객체에서 읽는다. 값이 Autosize·Autocalculate이거나 누락되면 확정 수치를 생성하지 않고 해당 상태를 보존한다.

설비 위치 좌표는 생성하지 않는다. BIM 설비와 연결되지 않은 설비는 미배치 상태로 두고, OE-IDF-08에서 위치와 실제 설비 식별 정보를 연결한다.

HVACTemplate만 있는 입력은 전처리된 상세 IDF가 필요함을 안내한다. 간략 모델·가상 장치만으로 실제 설비망을 생성하지 않는다.

## 수용 기준

- EquipmentList·EquipmentConnections·ZoneTerminalUnitList는 설비로 생성되지 않는다. AirDistributionUnit과 그 말단 장치는 중복 생성되지 않으며, IdealLoadsAirSystem은 실제 설비에서 제외된다.
- 냉난방 용량과 설계 풍량은 원본 또는 참조 객체의 값·단위와 일치한다. 자동 산정·누락 값은 확정 수치로 변환되지 않는다.
- BIM과 연결되지 않은 설비에는 위치 좌표가 없고 미배치 상태가 표시된다.
- 누락 참조·미지원 객체·해석할 수 없는 연결은 대상과 사유가 검토 결과에 표시된다. HVACTemplate만 있는 입력에는 상세 IDF 전처리 필요 안내가 표시된다.

## 검증 (이 repo)

—

## 메모

—
