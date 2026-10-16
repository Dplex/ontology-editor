#!/usr/bin/env node
// /issue 챗봇(scripts/issue-chat.mjs)이 gemini 에 붙이는 MCP 서버(stdio). 문서 도구(docs-tools.mjs)와 소스 읽는 도구(code-tools.mjs)뿐이다.
//
//   DOCS_ROOT=/path node scripts/issue-mcp.mjs     repo 루트(없으면 이 파일의 한 칸 위)
//
// **이슈를 올리는 도구는 여기 없다.** gemini 는 읽고 분석해 초안(JSON)을 답으로 낼 뿐이고, 올리는 것은 서버(issue-chat.mjs)가 초안을
// 검사한 뒤 gh 로 한다. 도구로 두면 질문 한 줄로 이슈를 여러 개 올리거나 라벨을 마음대로 붙이게 된다.
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { codeTools } from './code-tools.mjs'
import { DOCS_INSTRUCTIONS, docsTools } from './docs-tools.mjs'
import { serveMcp } from './mcp-stdio.mjs'

const ROOT = resolve(process.env.DOCS_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..'))
const INSTRUCTIONS = `${DOCS_INSTRUCTIONS}
- 소스는 code_search(글자로 찾기) → code_read(줄 번호로 읽기). 폴더 구조는 code_files. 화면 조각은 src/components/editor/, 상태·동작은 src/editor/, 계산은 src/lib/, 서버는 src/server/·scripts/ 다.
- 고치는 도구·이슈를 올리는 도구는 없다. 초안은 답으로 낸다.`
serveMcp({ name: 'ontology-editor-issue', tag: 'issue-mcp', instructions: INSTRUCTIONS, tools: [...docsTools(ROOT), ...codeTools(ROOT)] }).log(`root ${ROOT}`)
