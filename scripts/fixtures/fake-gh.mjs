#!/usr/bin/env node
// 시험용 가짜 gh. `auth status` 는 성공, `issue create` 는 받은 인자·본문·GH_HOST 를 FAKE_GH_LOG 에 적고 이슈 주소를 찍는다.
import { appendFileSync, readFileSync } from 'node:fs'

const args = process.argv.slice(2)
if (args[0] === 'auth') process.exit(process.env.FAKE_GH_AUTH === '0' ? 1 : 0)
if (args[0] === 'issue' && args[1] === 'create') {
  const body = readFileSync(0, 'utf8')
  appendFileSync(process.env.FAKE_GH_LOG, `${JSON.stringify({ args, body, host: process.env.GH_HOST })}\n`)
  console.log('https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/issues/777')
  process.exit(0)
}
process.exit(2)
