// 외부 시스템에 쓰는 도구를 호출하기 직전에 검증셋을 실행합니다.
// 하나라도 어긋나면 거부 결정을 출력해서 그 호출을 막습니다.
import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

// 검증셋을 통과해야만 호출할 수 있는 도구입니다.
const GATED = ['jira_create_issue', 'confluence_create_page']
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..')

// 표준 입력으로 도구 이름(toolName)과 인수(toolArgs)가 전달됩니다.
const { toolName = '' } = JSON.parse(fs.readFileSync(0, 'utf8'))

if (GATED.some(name => toolName.endsWith(name))) {
  const check = spawnSync(process.execPath, ['scripts/check.js'], { cwd: ROOT, encoding: 'utf8' })
  if (check.status !== 0) {
    const summary = check.stdout.trim().split('\n').at(-1)
    console.log(JSON.stringify({
      permissionDecision: 'deny',
      permissionDecisionReason: `검증셋이 통과하지 않아서 등록할 수 없습니다(${summary}). node scripts/check.js로 어긋난 항목을 먼저 확인하세요.`
    }))
  }
}
