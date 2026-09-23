<script setup lang="ts">
// 값이 어디서 왔는지 붙이는 표. 화면의 숫자와 색이 BIM 이 말한 것인지, 우리가 만든 것인지 구별하게 한다.
//
// - bim  : 파일에 적힌 그대로다(좌표, 형상, 계통, 포트 방향, BIM 이 말한 소속).
// - calc : BIM 의 좌표·형상만으로 계산했다(외곽선 안에 드는가로 정한 소속, 맞닿은 형상으로 추정한 연결).
//          바깥 지식은 안 들어가지만 BIM 이 직접 말한 것은 아니다.
// - dict : 우리가 만든 이름 사전과 흐름 규칙에서 나왔다(설비·방·계통 종류, Brick 클래스, 규칙 방향).
//          도메인 지식이 들어간 것이라 사전이 틀리면 같이 틀린다.
// - edit : 사람이 이 화면에서 고쳤다.
//
// 온톨로지를 받는 쪽이 이 셋을 구별할 수 없으므로, 적어도 만드는 쪽 화면에서는 구별되어야 한다.
export type SrcKind = 'bim' | 'calc' | 'dict' | 'edit'

defineProps<{ kind: SrcKind }>()

const LABEL: Record<SrcKind, string> = { bim: 'BIM', calc: '계산', dict: '사전', edit: '편집' }
const TITLE: Record<SrcKind, string> = {
  bim: 'BIM 파일에 적힌 그대로입니다.',
  calc: 'BIM 의 좌표·형상으로 계산했습니다. BIM 이 직접 말한 것은 아닙니다.',
  dict: '이름 사전·흐름 규칙(도메인 지식)으로 정했습니다. 사전이 틀리면 같이 틀립니다.',
  edit: '이 화면에서 사람이 고쳤습니다.',
}
</script>

<template>
  <span :class="['src', kind]" :title="TITLE[kind]">{{ LABEL[kind] }}</span>
</template>
