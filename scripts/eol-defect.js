import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { readText } from './judge.js'

// 따옴표 안의 쉼표를 처리하는 CSV 읽기
function* csvRows(text) {
  const input = text.replace(/^\uFEFF/, '')
  let row = []
  let field = ''
  let state = 'plain'
  let record = 1
  for (let i = 0; i <= input.length; i++) {
    const char = input[i]
    if (state === 'quoted') {
      if (char === undefined) throw new Error(`CSV 레코드 ${record}: 닫히지 않은 따옴표`)
      if (char !== '"') field += char
      else if (input[i + 1] === '"') {
        field += '"'
        i++
      } else state = 'closed'
    } else if (char === ',') {
      row.push(field)
      field = ''
      state = 'plain'
    } else if (char === '\r' || char === '\n' || char === undefined) {
      if (row.length || field.trim() || state === 'closed') yield row.concat(field)
      if (char === '\r' && input[i + 1] === '\n') i++
      row = []
      field = ''
      state = 'plain'
      record++
    } else if (char === '"' && state === 'plain' && !field) {
      state = 'quoted'
    } else if (char === '"' || state === 'closed') {
      throw new Error(`CSV 레코드 ${record}: 잘못된 따옴표`)
    } else {
      field += char
    }
  }
}


const ROOT = fileURLToPath(new URL('../', import.meta.url))
const COLUMNS = ['검사번호', '검사시각', '라인', '시리얼', '검사항목', '측정값', '하한', '상한', '비고']
const inspectionOrder = new Intl.Collator('en', { numeric: true, sensitivity: 'variant' })

class ValueError extends Error {}

export function parseInput(text) {
  const records = csvRows(text)
  const header = records.next().value?.map(value => value.trim())
  if (!header || new Set(header).size !== header.length || COLUMNS.some(key => !header.includes(key))) {
    throw new Error('CSV 필수 열 누락 또는 중복 열')
  }
  return Array.from(records, (values, index) => {
    if (values.length !== header.length) throw new Error(`CSV 레코드 ${index + 2}: 열 수 불일치`)
    return { ...Object.fromEntries(header.map((key, i) => [key, values[i]])), 원본행: index + 2 }
  })
}

export function parseTime(value) {
  const normalized = value.trim().replace(/^(\d{4})년\s*(\d{1,2})월\s*(\d{1,2})일\s*/, '$1-$2-$3 ')
  const match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})[T ](\d{1,2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?$/.exec(normalized)
  if (!match) throw new ValueError(`지원하지 않는 검사시각 형식: ${value}`)
  const [, y, mo, d, h, mi, s = '0', fraction = '0'] = match
  const parts = [y, mo, d, h, mi, s].map(Number)
  const [year, month, day, hour, minute, second] = parts
  const milliseconds = Number(fraction.padEnd(3, '0'))
  const stamp = Date.UTC(year, month - 1, day, hour, minute, second, milliseconds)
  const date = new Date(stamp)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 ||
      date.getUTCDate() !== day || date.getUTCHours() !== hour ||
      date.getUTCMinutes() !== minute || date.getUTCSeconds() !== second) {
    throw new ValueError(`유효하지 않은 검사시각: ${value}`)
  }
  return { stamp, text: date.toISOString().replace(/Z$/, ''), month: date.toISOString().slice(0, 7) }
}

function quantity(value) {
  const match = /^([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)(mV|V)?$/.exec(value.trim())
  if (!match) throw new ValueError(`수치 해석 불가: ${value}`)
  const number = Number(match[1]) / (match[2] === 'mV' ? 1000 : 1)
  if (!Number.isFinite(number)) throw new ValueError(`유한한 수치가 아님: ${value}`)
  return number
}

function compareInspections(a, b) {
  return a.time.stamp - b.time.stamp ||
    inspectionOrder.compare(a.id, b.id) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function aggregate(rows) {
  const products = new Map()
  const excluded = []
  const invalid = []
  const months = new Set()
  for (const [index, row] of rows.entries()) {
    const record = row.원본행 ?? index + 2
    const serial = row.시리얼
    if (serial?.startsWith('MST')) {
      excluded.push({ 원본행: record, 검사번호: row.검사번호, 시리얼: serial, 사유: '마스터 샘플' })
      continue
    }
    if (!serial?.trim() || !row.검사번호?.trim()) {
      invalid.push({ 원본행: record, 사유: '시리얼 또는 검사번호 누락', 입력: row })
      continue
    }
    if (!products.has(serial)) products.set(serial, new Map())
    const inspections = products.get(serial)
    if (!inspections.has(row.검사번호)) {
      inspections.set(row.검사번호, { id: row.검사번호, time: null, issues: [], items: [], records: [] })
    }
    const inspection = inspections.get(row.검사번호)
    inspection.records.push(record)
    try {
      const time = parseTime(row.검사시각)
      months.add(time.month)
      if (inspection.time && inspection.time.stamp !== time.stamp) {
        inspection.issues.push('같은 검사번호의 검사시각이 다름')
      } else {
        inspection.time = time
      }
    } catch (error) {
      if (!(error instanceof ValueError)) throw error
      inspection.issues.push(error.message)
      inspection.invalidTime = true
    }
    if (row.측정값 === 'ERR') {
      excluded.push({ 원본행: record, 검사번호: row.검사번호, 시리얼: serial, 사유: '통신 오류 ERR' })
      continue
    }
    try {
      if (!row.검사항목?.trim()) throw new ValueError('검사항목 누락')
      const value = quantity(row.측정값)
      const lower = quantity(row.하한)
      const upper = quantity(row.상한)
      if (lower > upper) throw new ValueError('하한이 상한보다 큼')
      inspection.items.push({
        원본행: record, 검사항목: row.검사항목,
        측정값: value, 하한: lower, 상한: upper,
        원본측정값: row.측정값,
        판정: value >= lower && value <= upper ? '합격' : '불합격'
      })
    } catch (error) {
      if (!(error instanceof ValueError)) throw error
      inspection.issues.push(`레코드 ${record}: ${error.message}`)
    }
  }

  const results = []
  for (const [serial, inspections] of products) {
    const candidates = [...inspections.values()]
    const badTime = candidates.find(item => !item.time || item.invalidTime ||
      item.issues.includes('같은 검사번호의 검사시각이 다름'))
    if (badTime) {
      results.push({
        시리얼: serial, 검사번호: null, 검사시각: null, 월: null, 판정: '판정 불가',
        불량항목: [], 사유: ['최종 검사 선택 불가', ...badTime.issues], 근거행: badTime.records
      })
      continue
    }
    const latest = candidates.sort(compareInspections).at(-1)
    const failures = latest.items.filter(item => item.판정 === '불합격')
    const reasons = [...latest.issues]
    if (!latest.items.length) reasons.push('ERR 제외 후 유효 측정값 없음')
    const verdict = reasons.length ? '판정 불가' : failures.length ? '불합격' : '합격'
    results.push({
      시리얼: serial, 검사번호: latest.id, 검사시각: latest.time.text, 월: latest.time.month,
      판정: verdict, 불량항목: failures, 사유: reasons, 근거행: latest.records
    })
  }
  results.sort((a, b) => a.시리얼 < b.시리얼 ? -1 : a.시리얼 > b.시리얼 ? 1 : 0)
  const monthly = [...months].sort().map(month => ({
    월: month,
    불량제품수: results.filter(item => item.월 === month && item.판정 === '불합격').length,
    판정불가: results.filter(item => item.월 === month && item.판정 === '판정 불가').length
  }))
  const max = Math.max(0, ...monthly.map(item => item.불량제품수))
  const unknown = results.filter(item => item.판정 === '판정 불가').length
  return {
    집계확정: unknown === 0 && invalid.length === 0,
    요약: {
      입력행수: rows.length, 제품수: results.length,
      합격: results.filter(item => item.판정 === '합격').length,
      불합격: results.filter(item => item.판정 === '불합격').length,
      판정불가: unknown, 식별불가행수: invalid.length,
      마스터제외행수: excluded.filter(item => item.사유 === '마스터 샘플').length,
      ERR제외행수: excluded.filter(item => item.사유 === '통신 오류 ERR').length
    },
    월별: monthly,
    최다월: max > 0 ? monthly.filter(item => item.불량제품수 === max).map(item => item.월) : [],
    최다월불량제품수: max,
    제품별: results,
    제외내역: excluded,
    식별불가행: invalid
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.join(ROOT, 'output'), { recursive: true })
  fs.writeFileSync(path.join(ROOT, 'output', file), `${JSON.stringify(value, null, 2)}\n`)
}

function writeMarkdown(file, lines) {
  fs.writeFileSync(path.join(ROOT, 'output', file), `${lines.join('\n')}\n`)
}

function assertSubset(actual, expected, location = '') {
  if (Array.isArray(expected)) {
    assert(Array.isArray(actual), location)
    assert.equal(actual.length, expected.length, `${location}.length`)
    expected.forEach((value, index) => assertSubset(actual[index], value, `${location}[${index}]`))
  } else if (expected !== null && typeof expected === 'object') {
    assert(actual !== null && typeof actual === 'object', location)
    for (const [key, value] of Object.entries(expected)) assertSubset(actual[key], value, `${location}.${key}`)
  } else {
    assert.deepEqual(actual, expected, location)
  }
}

export function checkCases() {
  const suite = JSON.parse(readText(path.join(ROOT, 'tests/eol-defect-cases.json')))
  assert(suite.케이스.length > 0, '검증 케이스 없음')
  assert.deepEqual(suite.열, COLUMNS, '검증셋 열 정의')
  assert.equal(new Set(suite.케이스.map(test => test.ID)).size, suite.케이스.length, '중복 케이스 ID')
  for (const kind of ['정상', '경계', '판정 불가']) {
    assert(suite.케이스.some(test => test.구분 === kind), `검증 유형 누락: ${kind}`)
  }
  const cases = suite.케이스.map(test => {
    let actual
    try {
      if (test.CSV !== undefined) {
        actual = aggregate(parseInput(test.CSV))
      } else {
        const rows = test.입력.map(values => {
          assert.equal(values.length, suite.열.length, `${test.ID}: 입력 열 수`)
          return Object.fromEntries(suite.열.map((key, i) => [key, values[i]]))
        })
        actual = aggregate(rows)
      }
    } catch (error) {
      if (!test.기대오류) throw error
      actual = { 오류: error.message }
    }
    const expected = test.기대오류 ? { 오류: test.기대오류 } : test.기대
    let match = true
    let reason = ''
    try {
      assertSubset(actual, expected)
    } catch (error) {
      if (!(error instanceof assert.AssertionError)) throw error
      match = false
      reason = error.message
    }
    return { ID: test.ID, 구분: test.구분, 일치: match, 기대: expected, 실제: actual, 불일치사유: reason }
  })
  const report = {
    전체: cases.length, 일치: cases.filter(item => item.일치).length,
    불일치: cases.filter(item => !item.일치).length, 케이스: cases
  }
  writeJson('eol-defect-check.json', report)
  writeMarkdown('eol-defect-check.md', [
    '# EOL 검증셋 실행 결과', '',
    `전체 ${report.전체}건, 일치 ${report.일치}건, 불일치 ${report.불일치}건`, '',
    '| 케이스 | 구분 | 결과 |', '| --- | --- | --- |',
    ...cases.map(item => `| ${item.ID} | ${item.구분} | ${item.일치 ? '일치' : '불일치'} |`),
    '', '상세 기대값·실제값·불일치 사유: [JSON](./eol-defect-check.json)'
  ])
  return report
}

function profile(rows) {
  const formats = {}
  const measurements = {}
  for (const row of rows) {
    const signature = row.검사시각.replace(/\d+/g, '#')
    formats[signature] ??= { 건수: 0, 예시: row.검사시각 }
    formats[signature].건수++
    const kind = row.측정값.replace(/[+-]?(?:\d+(?:\.\d*)?|\.\d+)/g, '#')
    measurements[kind] ??= { 건수: 0, 예시: row.측정값 }
    measurements[kind].건수++
  }
  return { 입력행수: rows.length, 검사시각형식: formats, 측정값형식: measurements, 검사항목: [...new Set(rows.map(row => row.검사항목))] }
}

function reportResult(result) {
  writeJson('eol-defect-result.json', result)
  writeMarkdown('eol-defect-result.md', [
    '# EOL 월별 불량 제품 집계', '',
    `상태: ${result.집계확정 ? '집계 확정' : '판정 불가 포함 — 확정 보류'}`,
    `입력: ${result.입력파일}`, `SHA-256: ${result.SHA256}`, '',
    `제품 ${result.요약.제품수}개: 합격 ${result.요약.합격}개, 불합격 ${result.요약.불합격}개, 판정 불가 ${result.요약.판정불가}개`,
    `마스터 제외 ${result.요약.마스터제외행수}행, ERR 제외 ${result.요약.ERR제외행수}행, 식별 불가 ${result.요약.식별불가행수}행`, '',
    '| 월 | 불량 제품 수 | 판정 불가 |', '| --- | ---: | ---: |',
    ...result.월별.map(item => `| ${item.월} | ${item.불량제품수} | ${item.판정불가} |`),
    '', `최다 불량 월: ${result.최다월.join(', ') || '없음'} / ${result.최다월불량제품수}개`,
    '', '월은 마지막 검사시각에 귀속합니다. 최다 월이 동률이면 모두 표시합니다.',
    '제품별 판정·근거행·제외 내역·판정 불가 사유: [JSON](./eol-defect-result.json)',
    '필수 검사항목 목록은 제공되지 않아 누락 항목의 완전성은 검증하지 않았습니다.',
    '외부 전송은 수행하지 않았습니다.'
  ])
}

function compareManual(result, args) {
  const [total, month, count] = args
  if (!/^\d+$/.test(total) || !/^\d{4}-(0[1-9]|1[0-2])$/.test(month) || !/^\d+$/.test(count)) {
    throw new Error('--compare 사용법: --compare 불량총수 YYYY-MM 최다월불량수')
  }
  const expected = { 불량제품수: Number(total), 최다월: [month], 최다월불량제품수: Number(count) }
  const actual = { 불량제품수: result.요약.불합격, 최다월: result.최다월, 최다월불량제품수: result.최다월불량제품수 }
  const matches = {
    불량제품수: expected.불량제품수 === actual.불량제품수,
    최다월: JSON.stringify(expected.최다월) === JSON.stringify(actual.최다월),
    최다월불량제품수: expected.최다월불량제품수 === actual.최다월불량제품수
  }
  const comparison = {
    용도: '이번 실행의 수작업 참고값 비교. 상시 판정 기준이 아님',
    입력파일: result.입력파일, SHA256: result.SHA256, 기대: expected, 실제: actual,
    항목별일치: matches, 불량제품수차이: actual.불량제품수 - expected.불량제품수,
    일치: result.집계확정 && Object.values(matches).every(Boolean),
    주의: '제공된 총수·최다 월만 비교했으며 월별 표 전체의 일치를 검증한 것은 아님'
  }
  writeJson('eol-defect-comparison.json', comparison)
  writeMarkdown('eol-defect-comparison.md', [
    '# 이번 실행의 수작업 집계 비교', '',
    `결과: ${comparison.일치 ? '일치' : '불일치 또는 집계 미확정'}`, '',
    '| 항목 | 수작업 참고값 | 스크립트 결과 | 일치 |', '| --- | --- | --- | --- |',
    `| 불량 제품 수 | ${expected.불량제품수} | ${actual.불량제품수} | ${matches.불량제품수} |`,
    `| 최다 불량 월 | ${expected.최다월.join(', ')} | ${actual.최다월.join(', ')} | ${matches.최다월} |`,
    `| 최다 월 불량 수 | ${expected.최다월불량제품수} | ${actual.최다월불량제품수} | ${matches.최다월불량제품수} |`,
    '', `불량 제품 수 차이: ${comparison.불량제품수차이}개`, '', comparison.주의,
    '', '불일치 시 확인할 항목: 제외 내역, 최종 검사 선택, 단위 변환, 월 귀속, 판정 불가.'
  ])
  return comparison
}

function main() {
  const args = process.argv.slice(2)
  if (!(args.length === 0 || (args.length === 1 && ['--check', '--profile'].includes(args[0])) ||
      (args.length === 4 && args[0] === '--compare'))) {
    throw new Error('사용법: node scripts/eol-defect.js [--check | --profile | --compare 불량총수 YYYY-MM 최다월불량수]')
  }
  if (args[0] !== '--profile') {
    const check = checkCases()
    if (check.불일치) {
      console.error('검증셋 불일치: output/eol-defect-check.json 확인')
      process.exitCode = 1
      return
    }
    if (args[0] === '--check') return
  }
  const input = path.join(ROOT, 'practice/eol-results.csv')
  const text = readText(input)
  const rows = parseInput(text)
  writeJson('eol-defect-profile.json', profile(rows))
  if (args[0] === '--profile') return
  if (!rows.length) throw new Error('입력 CSV에 검사 기록이 없습니다.')
  const result = {
    입력파일: 'practice/eol-results.csv',
    SHA256: createHash('sha256').update(fs.readFileSync(input)).digest('hex'),
    ...aggregate(rows)
  }
  reportResult(result)
  if (args[0] === '--compare' && !compareManual(result, args.slice(1)).일치) process.exitCode = 1
  if (!result.집계확정) process.exitCode = 1
  console.log('집계 및 검증 결과를 output/eol-defect-*.json, *.md에 저장했습니다.')
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    main()
  } catch (error) {
    console.error(`EOL 집계 실패: ${error.message}`)
    process.exitCode = 1
  }
}
