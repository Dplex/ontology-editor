<script setup lang="ts">
// 프로젝트 목록과 층 선택 화면(OE-UI-02·03). 첫 화면이다. 모드는 사용자가 고르지 않는다 — 구축 전 프로젝트는 누르면 바로 에디터(초기 구축),
// 구축을 마친 프로젝트는 층 선택 화면을 거쳐 운영 편집이다. 새 초기 구축 작업본은 [새 프로젝트]로만 만든다.
// 네트워크(올리기·만들기·열기)는 App.vue 가 한다. 여기서는 보이고 고르기만 한다.
import { computed, ref } from 'vue'
import { buildingsOf, lastActivity, siteTotals, type ProjectRow } from '../lib/projects'

const props = defineProps<{
  rows: readonly ProjectRow[]
  /** 만들 수 없는 까닭(사람을 안 골랐거나 보기 전용). null 이면 만들 수 있다. */
  createBlock: string | null
  busy: boolean
  /** 그 IFC 가 무슨 분야인지(건축·설비). 잴 수 없으면 빈칸. */
  fieldOf: (path: string) => string
  when: (iso: string) => string
}>()
const emit = defineEmits<{
  open: [row: ProjectRow, storey: string | null]
  create: [input: { name: string; site: string; files: File[] }]
}>()

const baseName = (p: string) => p.split('/').at(-1)!.replace(/^\d{8}-\d{6}-/, '')
const expanded = ref<Set<string>>(new Set())
function toggle(id: string) {
  const next = new Set(expanded.value)
  if (!next.delete(id)) next.add(id)
  expanded.value = next
}

// --- 새 프로젝트(시작 화면 OE-UI-15 ①) — 이름·사이트를 정하고 IFC 를 올리는 것뿐이다. IDF 는 IFC 와 같이 올리면 공조존을 얹는다 —
// 프로젝트는 반드시 IFC 를 쓴다(OE-UI-02). ---
const form = ref<{ name: string; site: string; files: File[] } | null>(null)
const missing = computed(() => {
  const f = form.value
  if (!f) return ''
  const need = [!f.name.trim() && '프로젝트 이름', !f.site.trim() && '사이트 이름', !f.files.some((x) => /\.ifc$/i.test(x.name)) && 'IFC 파일'].filter(Boolean)
  return need.length ? `${need.join(' · ')}을(를) 입력해 주세요` : ''
})
function pickFiles(e: Event) {
  if (!form.value) return
  form.value = { ...form.value, files: Array.from((e.target as HTMLInputElement).files ?? []).filter((f) => /\.(ifc|idf)$/i.test(f.name)) }
}
function submit() {
  const f = form.value
  if (!f || missing.value || props.busy) return
  emit('create', { name: f.name.trim(), site: f.site.trim(), files: f.files })
}
defineExpose({ closeForm: () => (form.value = null) })

// --- 층 선택(구축을 마친 프로젝트만) ---
const picking = ref<ProjectRow | null>(null)
function open(p: ProjectRow) {
  if (p.built) picking.value = p
  else emit('open', p, null)
}
const pickBuildings = computed(() => (picking.value ? buildingsOf(picking.value) : []))
</script>

<template>
  <section class="projects" aria-label="프로젝트">
    <!-- 층 선택 화면(OE-UI-03). 건물별로 묶고 층마다 [운영 편집]. 층별 [초기 구축] 은 두지 않는다. -->
    <template v-if="picking">
      <header class="projects-head">
        <h2>{{ picking.name }} <small class="muted">{{ picking.site }} · 구축 완료 v{{ picking.built!.version }}</small></h2>
        <button type="button" class="ghost" @click="picking = null">← 프로젝트 목록</button>
      </header>
      <p class="muted">선택한 층을 운영 편집 모드로 엽니다. 임시 저장본이 있는 층은 저장된 내용부터 이어서 편집합니다.</p>
      <p v-if="!pickBuildings.length" class="muted">
        아직 프로젝트를 열지 않아 층 구성을 확인할 수 없습니다.
        <button type="button" class="ghost" :disabled="busy" :title="busy ? '파일을 여는 중입니다' : ''" @click="emit('open', picking, null)">모든 층으로 열기</button>
      </p>
      <div v-for="b in pickBuildings" :key="b.name" class="storey-group" data-testid="storey-group">
        <h3>
          {{ b.name }} <span class="muted">{{ b.range }} · {{ b.storeys.length }}개 층 · 임시 저장본 {{ b.drafted }}개 층</span>
        </h3>
        <table>
          <tbody>
            <tr v-for="s in b.storeys" :key="s.key" data-testid="storey-row">
              <td class="name">{{ s.label }}</td>
              <td><span v-if="s.drafted" class="saved-chip" title="이 층에 임시 저장본이 있습니다">임시 저장본</span></td>
              <td class="row-actions">
                <button type="button" class="ghost" :disabled="busy" :title="busy ? '파일을 여는 중입니다' : `${s.label}을(를) 운영 편집으로 엽니다`" @click="emit('open', picking!, s.key)">운영 편집</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </template>

    <template v-else>
      <header class="projects-head">
        <h2>프로젝트 <small class="muted">{{ rows.length }}개</small></h2>
        <!-- 비활성 버튼은 툴팁으로 까닭을 보인다(OE-UI-03 AC5). -->
        <button
          type="button"
          class="pick"
          :disabled="!!createBlock || busy"
          :title="createBlock ?? (busy ? '파일을 여는 중입니다' : '이름과 사이트를 입력하고 IFC 파일을 업로드해 초기 구축을 시작합니다')"
          @click="form = { name: '', site: '', files: [] }"
        >
          새 프로젝트
        </button>
      </header>

      <form v-if="form" class="new-project" aria-label="새 프로젝트" @submit.prevent="submit">
        <label>프로젝트 이름 <input v-model="form.name" type="text" maxlength="100" aria-label="프로젝트 이름" /></label>
        <label>사이트 이름 <input v-model="form.site" type="text" maxlength="100" aria-label="사이트 이름" /></label>
        <label class="pick">
          IFC 파일 올리기
          <input type="file" accept=".ifc,.idf" multiple aria-label="IFC 파일" @change="pickFiles" />
        </label>
        <span class="muted">{{ form.files.length ? form.files.map((f) => f.name).join(' + ') : '건축·설비 파일이 나뉘어 있으면 함께 선택하세요. IDF 도 같이 고르면 공조존을 얹습니다' }}</span>
        <button type="submit" class="pick" :disabled="!!missing || busy" :title="missing || (busy ? '올리는 중입니다' : '')">만들기</button>
        <button type="button" class="ghost" @click="form = null">취소</button>
      </form>

      <p v-if="!rows.length && !form" class="muted">프로젝트가 없습니다. [새 프로젝트]로 IFC 파일을 올려 시작하세요.</p>
      <table v-else-if="rows.length">
        <tbody>
          <template v-for="p in rows" :key="p.id">
            <tr class="project-row" data-testid="project-row">
              <td class="pick-cell">
                <button type="button" class="link" :aria-expanded="expanded.has(p.id)" :aria-label="`${p.name} 건물별 보기`" :disabled="!p.summary" :title="p.summary ? '' : '처음 열 때 건물·층 정보를 불러옵니다'" @click="toggle(p.id)">
                  {{ expanded.has(p.id) ? '▾' : '▸' }}
                </button>
              </td>
              <td class="name">
                <span><b>{{ p.name }}</b> · {{ p.site }}</span>
                <span class="muted">{{ p.paths.map((x) => `${baseName(x)}${fieldOf(x) ? ` (${fieldOf(x)})` : ''}`).join(' + ') }}</span>
              </td>
              <td>
                <span :class="['saved-chip', { 'published-chip': p.built }]">{{ p.built ? `구축 완료 · v${p.built.version}` : '구축 전' }}</span>
              </td>
              <td class="progress" data-testid="project-progress">
                <template v-if="siteTotals(p)">
                  건물 {{ siteTotals(p)!.buildings }} · 층 {{ siteTotals(p)!.storeys }} ·
                  {{ p.built ? `임시 저장본 ${siteTotals(p)!.drafted}개 층` : `임시 저장 ${siteTotals(p)!.drafted}/${siteTotals(p)!.storeys}` }}
                </template>
                <span v-else class="muted">층 수 미확인(처음 열 때 불러옵니다)</span>
              </td>
              <td class="muted">{{ lastActivity(p).what }} · {{ lastActivity(p).by }} · {{ when(lastActivity(p).at) }}</td>
              <td class="row-actions">
                <button type="button" class="ghost" :disabled="busy" :title="busy ? '파일을 여는 중입니다' : p.built ? '층을 골라 운영 편집으로 엽니다' : '초기 구축 에디터를 엽니다'" @click="open(p)">열기</button>
              </td>
            </tr>
            <tr v-for="b in expanded.has(p.id) ? buildingsOf(p) : []" :key="`${p.id}:${b.name}`" class="building-row" data-testid="building-row">
              <td></td>
              <td class="name">{{ b.name }}</td>
              <td>{{ b.range }}</td>
              <td>층 {{ b.storeys.length }} · {{ p.built ? `임시 저장본 ${b.drafted}개 층` : `임시 저장 ${b.drafted}/${b.storeys.length}` }}</td>
              <td colspan="2"></td>
            </tr>
          </template>
        </tbody>
      </table>
    </template>
  </section>
</template>
