<script setup lang="ts">
// 한 계통의 흐름 방향 근거(lib/flow-cascade.ts 의 flowBasis). 1 BIM 포트 · 2 규칙 · 3 사람이 정한 방향을 세로로 잇고, 그 결과 TTL 에
// brick:feeds 로 나가는 연결 수를 맨 아래에 둔다 — "어디서 와서 무엇이 나가나" 가 위에서 아래로 읽힌다. 고른 설비의 규칙 상자와 고른
// 계통 패널이 같이 쓴다.
import type { FlowBasis } from '../lib/flow-cascade'
import Src from './Src.vue'

defineProps<{ basis: FlowBasis; name: string }>()
</script>

<template>
  <ol class="flow-basis" data-testid="flow-basis" :aria-label="`${name} 흐름 방향 근거`">
    <li>
      <span class="step-no">1</span>
      <span><Src kind="bim" /> BIM 포트가 말한 방향</span>
      <b>{{ basis.bim }}</b>
    </li>
    <li>
      <span class="step-no">2</span>
      <span>
        <Src kind="dict" /> 규칙(계통·설비 종류)이 정한 방향
        <small class="muted">확정 {{ basis.ruleConfirmed }}<template v-if="basis.ruleRecheck"> · 재검토 {{ basis.ruleRecheck }}</template></small>
      </span>
      <b>{{ basis.rule }}</b>
    </li>
    <li>
      <span class="step-no">3</span>
      <span><Src kind="edit" /> 사람이 정한 방향</span>
      <b>{{ basis.edited }}</b>
    </li>
    <li class="flow-basis-result">
      <span class="step-no">→</span>
      <span>
        TTL <code>brick:feeds</code>
        <small class="muted">포트 · 사람 · 확정한 규칙만<template v-if="basis.unknown"> · 방향 모름 {{ basis.unknown }}</template><template v-if="basis.review"> · 흐름 아님 {{ basis.review }}</template></small>
      </span>
      <b>{{ basis.feeds }}<small class="muted">/{{ basis.total }}</small></b>
    </li>
  </ol>
</template>
