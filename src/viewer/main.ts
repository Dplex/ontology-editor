// 내보낸 파일 뷰어(viewer.html). 에디터와 따로 뜨는 페이지다 — 에디터 상태 없이, 내려받은 파일만 다시 읽는다.
import { createApp } from 'vue'
import ExportViewer from './ExportViewer.vue'
import '../styles.css'

createApp(ExportViewer).mount('#app')
