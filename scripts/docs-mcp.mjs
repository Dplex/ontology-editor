#!/usr/bin/env node
// 이 repo 의 문서(PRD·티켓·ADR·intent.md)를 읽기만 하는 MCP 서버(stdio). 55 의 문서 챗봇이 gemini 에 붙인다(docs/dev/deploy55.md).
//
//   node scripts/docs-mcp.mjs              repo 루트는 이 파일의 한 칸 위
//   DOCS_ROOT=/path node scripts/docs-mcp.mjs
//
// 도구는 docs-tools.mjs, 프로토콜은 mcp-stdio.mjs 에 있다. **문서를 고치는 도구는 없다.**
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { DOCS_INSTRUCTIONS, docsTools } from './docs-tools.mjs'
import { serveMcp } from './mcp-stdio.mjs'

const ROOT = resolve(process.env.DOCS_ROOT || resolve(dirname(fileURLToPath(import.meta.url)), '..'))
serveMcp({ name: 'ontology-editor-docs', tag: 'docs-mcp', instructions: DOCS_INSTRUCTIONS, tools: docsTools(ROOT) }).log(`root ${ROOT}`)
