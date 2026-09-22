<script setup lang="ts">
import { computed, ref } from 'vue'
import { parsePrefixes } from './lib/ttl'

const fileName = ref('')
const text = ref('')
const error = ref('')
const dragging = ref(false)

const prefixes = computed(() => parsePrefixes(text.value))
const lineCount = computed(() => (text.value === '' ? 0 : text.value.split(/\r?\n/).length))

async function load(file: File) {
  error.value = ''
  try {
    text.value = await file.text()
    fileName.value = file.name
  } catch (e) {
    // 읽기에 실패한 채로 이전 파일 내용을 남겨 두면, 화면이 방금 연 파일을 보여 주는
    // 것처럼 보인다. 그래서 내용을 비우고 무엇이 실패했는지 말한다.
    text.value = ''
    fileName.value = ''
    error.value = `파일을 읽지 못했습니다: ${e instanceof Error ? e.message : String(e)}`
  }
}

function onPick(event: Event) {
  const file = (event.target as HTMLInputElement).files?.[0]
  if (file) void load(file)
}

function onDrop(event: DragEvent) {
  dragging.value = false
  const file = event.dataTransfer?.files?.[0]
  if (file) void load(file)
}
</script>

<template>
  <main>
    <header>
      <h1>ontology-editor</h1>
      <p class="sub">Turtle 파일을 열어 접두사 선언을 확인합니다.</p>
    </header>

    <section
      class="drop"
      :class="{ over: dragging }"
      @dragover.prevent="dragging = true"
      @dragleave.prevent="dragging = false"
      @drop.prevent="onDrop"
    >
      <p>.ttl 파일을 여기에 끌어다 놓으세요.</p>
      <label class="pick">
        파일 선택
        <input type="file" accept=".ttl,text/turtle" @change="onPick" />
      </label>
    </section>

    <p v-if="error" class="error" role="alert">{{ error }}</p>

    <section v-if="fileName" class="loaded">
      <h2>{{ fileName }}</h2>
      <p class="stats">{{ lineCount.toLocaleString() }}줄 · 접두사 {{ prefixes.length }}개</p>

      <table v-if="prefixes.length">
        <thead>
          <tr>
            <th>접두사</th>
            <th>IRI</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in prefixes" :key="p.name">
            <td class="mono">{{ p.name }}:</td>
            <td class="mono iri">{{ p.iri }}</td>
          </tr>
        </tbody>
      </table>
      <p v-else class="empty">접두사 선언이 없습니다.</p>
    </section>
  </main>
</template>
