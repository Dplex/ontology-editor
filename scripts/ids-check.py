# docs/requirements.ids 를 고객사처럼 ifctester 로 돌린다(check-sample.test.ts 의 "IDS 를 ifctester 로" 가 부른다).
# IDS 1.0 XSD 로 먼저 검사하고, 파일마다 명세별로 대상 수·통과 수를 JSON 으로 낸다.
#
# ifctester 0.8.5·0.9.0 은 파생 단위를 쓴 범위 값(ifc4Mep 의 AirFlowrateRange)을 환산하다 예외를 낸다(IfcDerivedUnit 에 Name 이
# 없다). 검사 도구의 문제라 그 환산만 건너뛴다 — 정본 4장 "가진 파일로 확인한 결과" 와 같은 조건이다.
import json
import sys

import ifcopenshell
import ifcopenshell.util.unit
from ifctester import ids, reporter

_unit = ifcopenshell.util.unit.get_property_unit


def _named_unit(prop, ifc_file):
    unit = _unit(prop, ifc_file)
    return None if unit is not None and unit.is_a('IfcDerivedUnit') else unit


ifcopenshell.util.unit.get_property_unit = _named_unit

spec = ids.open(sys.argv[1], validate=True)  # XSD 에 어긋나면 여기서 멈춘다
out = {'specifications': len(spec.specifications), 'files': {}}
for path in sys.argv[2:]:
    spec.validate(ifcopenshell.open(path))
    report = reporter.Json(spec)
    report.report()
    out['files'][path] = [
        {
            'name': s['name'],
            'inSchema': s['is_ifc_version'],
            'applicable': s.get('total_applicable', 0),
            'pass': s['total_checks_pass'],
            'checks': s['total_checks'],
            'status': s['status'],
        }
        for s in report.results['specifications']
    ]
json.dump(out, sys.stdout, ensure_ascii=False)
