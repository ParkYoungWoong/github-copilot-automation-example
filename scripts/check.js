// 판정 스크립트를 다시 실행해서 검증셋(tests/cases.json)의 기대 결과와 비교합니다.
// 실행: node scripts/check.js
import fs from 'node:fs'
import { judge, parseCsv, readText } from './judge.js'

const CASES_FILE = 'data/test-cases.csv'
const EXPECT_FILE = 'tests/cases.json'

// 기대와 결과를 비교해서 일치, 오탐, 미탐, 불일치 중 하나로 분류합니다.
function classify(expected, actual) {
  if (expected.판정 === actual.판정) {
    const noteOk = !expected.비고 || actual.비고.includes(expected.비고)
    return noteOk ? '일치' : '불일치'
  }
  if (expected.판정 === 'Pass' && actual.판정 === 'Fail') return '오탐'
  if (expected.판정 === 'Fail' && actual.판정 === 'Pass') return '미탐'
  return '불일치'
}

const show = r => [r.판정, r.비고].filter(Boolean).join(' ')

const cases = parseCsv(readText(CASES_FILE))
const expectations = JSON.parse(fs.readFileSync(EXPECT_FILE, 'utf8'))
const counts = {}

for (const expected of expectations) {
  const tc = cases.find(c => c.TC === expected.TC)
  if (!tc) {
    console.log(`${expected.TC}  ${CASES_FILE}에 없는 시험 항목입니다`)
    counts.불일치 = (counts.불일치 ?? 0) + 1
    continue
  }
  const actual = judge(tc)
  const verdict = classify(expected, actual)
  counts[verdict] = (counts[verdict] ?? 0) + 1
  const hint = verdict !== '일치' && expected.확인 ? `  (확인: ${expected.확인})` : ''
  console.log(`${expected.TC}  ${expected.구분}  기대 ${show(expected)}  결과 ${show(actual)}  ${verdict}${hint}`)
}

const summary = ['일치', '오탐', '미탐', '불일치']
  .filter(k => counts[k])
  .map(k => `${k} ${counts[k]}`)
  .join(', ')
console.log('')
console.log(`검증 ${expectations.length}건: ${summary}`)

// 하나라도 어긋나면 종료 코드 1로 끝내서 자동 실행에서도 실패를 알 수 있게 합니다.
if (summary !== `일치 ${expectations.length}`) process.exitCode = 1
