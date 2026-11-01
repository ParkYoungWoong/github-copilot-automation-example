// 시험 항목마다 로그를 읽어 docs/test-rules.md 규칙대로 판정합니다.
// 실행: node scripts/judge.js
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'

const CASES_FILE = 'data/test-cases.csv'
const LOG_DIR = 'data/logs'
const OUT_DIR = 'output'

// 규칙 문서의 값을 그대로 옮긴 상수입니다.
const SETTLE_SECONDS = 300 // 안정화 구간(초)
const MAX_GAP_SECONDS = 3 // 이 간격을 넘으면 기록 끊김
const MIN_SAMPLES = 600 // 안정화 이후 최소 샘플 수
const TIGHT_RANGE = { min: -10, max: 85 } // 0.5도 구간(양 끝 포함)
const TOLERANCE = { tight: 0.5, wide: 1.0 }

// 열 이름 별칭. 왼쪽이 스크립트 안에서 쓰는 이름입니다.
const COLUMNS = {
  time: ['time_s', '시간(초)'],
  ref: ['ref_c', '기준온도'],
  sensor: ['sensor_c', '센서온도'],
  supply: ['supply_v', '전원전압']
}
const REQUIRED = ['time', 'ref', 'sensor']

// UTF-8로 읽어 보고, 깨지면 CP949(엑셀 기본 저장)로 다시 읽습니다.
function readText(file) {
  const buf = fs.readFileSync(file)
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '')
  } catch {
    return new TextDecoder('euc-kr').decode(buf)
  }
}

// 따옴표 없는 단순 CSV를 객체 배열로 바꿉니다.
function parseCsv(text) {
  const [head, ...lines] = text.trim().split(/\r?\n/)
  const keys = head.split(',').map(k => k.trim())
  return lines.map(line => {
    const values = line.split(',')
    return Object.fromEntries(keys.map((k, i) => [k, values[i]?.trim() ?? '']))
  })
}

// 로그의 열 이름을 별칭 표에 맞춰 time, ref, sensor 같은 이름으로 바꿉니다.
function mapColumns(rows) {
  const keys = Object.keys(rows[0] ?? {})
  const found = {}
  for (const [name, aliases] of Object.entries(COLUMNS)) {
    const key = keys.find(k => aliases.includes(k))
    if (key) found[name] = key
  }
  const missing = REQUIRED.filter(name => !found[name])
  const samples = rows.map(row => ({
    time: Number(row[found.time]),
    ref: Number(row[found.ref]),
    sensor: Number(row[found.sensor])
  }))
  return { samples, missing }
}

// 목표 온도로 허용 오차를 정합니다.
function toleranceFor(target) {
  return target >= TIGHT_RANGE.min && target <= TIGHT_RANGE.max ? TOLERANCE.tight : TOLERANCE.wide
}

// 샘플 간격이 기준을 넘는 가장 긴 구간을 찾습니다.
function findLongestGap(samples) {
  let gap = null
  for (let i = 1; i < samples.length; i++) {
    const seconds = samples[i].time - samples[i - 1].time
    if (seconds > MAX_GAP_SECONDS && (!gap || seconds > gap.seconds)) {
      gap = { from: samples[i - 1].time, to: samples[i].time, seconds }
    }
  }
  return gap
}

const fmt = n => n.toLocaleString('en-US')

// 시험 항목 하나를 판정합니다.
export function judge(tc, logDir = LOG_DIR) {
  const target = Number(tc.목표온도)
  const tolerance = toleranceFor(target)
  const result = {
    TC: tc.TC,
    항목: tc.항목,
    요구사항: tc.요구사항,
    로그파일: tc.로그파일,
    목표온도: target,
    허용오차: tolerance,
    샘플수: 0,
    최대오차: null,
    최대오차시각: null,
    판정: '판정 불가',
    비고: '',
    근거: ''
  }
  const file = path.join(logDir, tc.로그파일)
  if (!fs.existsSync(file)) {
    return { ...result, 비고: '로그 없음', 근거: `${file} 파일이 없습니다` }
  }

  const { samples, missing } = mapColumns(parseCsv(readText(file)))
  if (missing.length) {
    return { ...result, 비고: '열 누락', 근거: `필수 열 없음: ${missing.join(', ')}` }
  }

  const settled = samples.filter(s => s.time >= SETTLE_SECONDS)
  result.샘플수 = settled.length
  if (settled.length < MIN_SAMPLES) {
    return { ...result, 비고: '샘플 부족', 근거: `안정화 이후 ${settled.length}개, 기준 ${MIN_SAMPLES}개` }
  }

  // 안정화 이후 오차의 절댓값이 가장 큰 샘플을 찾습니다.
  let worst = settled[0]
  for (const s of settled) {
    if (Math.abs(s.sensor - s.ref) > Math.abs(worst.sensor - worst.ref)) worst = s
  }
  result.최대오차 = Number(Math.abs(worst.sensor - worst.ref).toFixed(2))
  result.최대오차시각 = worst.time

  const notes = []
  const reasons = []
  const gap = findLongestGap(samples)
  if (gap) {
    notes.push('기록 끊김')
    reasons.push(`${fmt(gap.from)}초와 ${fmt(gap.to)}초 사이 ${gap.seconds}초 동안 기록 없음`)
  }
  if (result.최대오차 > tolerance) {
    notes.push('오차 초과')
    reasons.push(`최대 오차 ${result.최대오차}도(${fmt(worst.time)}초) > 허용 ${tolerance.toFixed(1)}도`)
  } else {
    reasons.push(`최대 오차 ${result.최대오차}도 <= 허용 ${tolerance.toFixed(1)}도`)
  }

  return {
    ...result,
    판정: notes.length ? 'Fail' : 'Pass',
    비고: notes.join(', '),
    근거: reasons.join(', ')
  }
}

// 판정 결과를 사람이 읽는 마크다운 표로 만듭니다.
function toMarkdown(results) {
  const count = name => results.filter(r => r.판정 === name).length
  const lines = [
    '# 시험 판정 결과',
    '',
    `- 전체 ${results.length}건: Pass ${count('Pass')}, Fail ${count('Fail')}, 판정 불가 ${count('판정 불가')}`,
    '- 기준: docs/test-rules.md',
    '',
    '| TC | 항목 | 요구사항 | 목표 온도 | 허용 오차 | 최대 오차 | 판정 | 비고 | 근거 |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...results.map(r =>
      `| ${r.TC} | ${r.항목} | ${r.요구사항} | ${r.목표온도} | ${r.허용오차.toFixed(1)} | ${r.최대오차 ?? ''} | ${r.판정} | ${r.비고} | ${r.근거} |`
    )
  ]
  return lines.join('\n') + '\n'
}

// 엑셀에서 한글이 깨지지 않도록 BOM을 붙인 CSV로 만듭니다.
function toCsv(results) {
  const keys = Object.keys(results[0])
  const rows = results.map(r => keys.map(k => `"${String(r[k] ?? '').replace(/"/g, '""')}"`).join(','))
  return '﻿' + [keys.join(','), ...rows].join('\r\n') + '\r\n'
}

// 직접 실행했을 때만 전체 판정을 진행합니다(check.js에서 judge 함수를 가져다 쓰기 위함).
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!fs.existsSync(CASES_FILE)) {
    console.error(`${CASES_FILE} 파일이 없습니다. 저장소 최상위 폴더에서 실행하세요.`)
    process.exit(1)
  }
  const cases = parseCsv(readText(CASES_FILE))
  const results = cases.map(tc => judge(tc))
  fs.mkdirSync(OUT_DIR, { recursive: true })
  fs.writeFileSync(path.join(OUT_DIR, 'tc-result.json'), JSON.stringify(results, null, 2) + '\n')
  fs.writeFileSync(path.join(OUT_DIR, 'tc-result.md'), toMarkdown(results))
  fs.writeFileSync(path.join(OUT_DIR, 'tc-result.csv'), toCsv(results))

  const count = name => results.filter(r => r.판정 === name).length
  console.log(`판정 완료: ${results.length}건`)
  console.log(`  Pass ${count('Pass')}, Fail ${count('Fail')}, 판정 불가 ${count('판정 불가')}`)
  console.log('결과 파일: output/tc-result.md, output/tc-result.csv, output/tc-result.json')
}

export { parseCsv, readText, mapColumns, SETTLE_SECONDS, MAX_GAP_SECONDS }
