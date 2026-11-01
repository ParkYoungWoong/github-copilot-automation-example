// 판정 결과(output/tc-result.json)와 로그로 그래프가 들어간 HTML 보고서를 만듭니다.
// 실행: node scripts/report.js (먼저 node scripts/judge.js 실행)
import fs from 'node:fs'
import path from 'node:path'
import { parseCsv, readText, mapColumns, SETTLE_SECONDS, MAX_GAP_SECONDS } from './judge.js'

const RESULT_FILE = 'output/tc-result.json'
const LOG_DIR = 'data/logs'
const OUT_FILE = 'output/test-report.html'
const BUCKET_SECONDS = 30 // 그래프 한 칸에 묶을 시간(초)

const COLOR = { Pass: '#1a7f37', Fail: '#cf222e', '판정 불가': '#6e7781' }
const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// 최대 오차와 허용 오차를 TC별 가로 막대로 비교합니다.
function errorBars(results) {
  const W = 900
  const rowH = 34
  const left = 190
  const right = 60
  const H = results.length * rowH + 50
  const maxX = 1.2
  const x = v => left + (v / maxX) * (W - left - right)
  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="TC별 최대 오차">`
  for (const v of [0, 0.25, 0.5, 0.75, 1.0]) {
    s += `<line x1="${x(v)}" y1="10" x2="${x(v)}" y2="${H - 30}" stroke="#d0d7de" stroke-dasharray="${v ? '3 3' : ''}"/>`
    s += `<text x="${x(v)}" y="${H - 10}" text-anchor="middle" class="tick">${v.toFixed(2)}도</text>`
  }
  results.forEach((r, i) => {
    const y = 20 + i * rowH
    s += `<text x="${left - 12}" y="${y + 11}" text-anchor="end" class="label">${esc(r.TC)} ${esc(r.항목)}</text>`
    if (r.최대오차 === null) {
      s += `<text x="${x(0) + 8}" y="${y + 11}" class="muted">${esc(r.판정)} (${esc(r.비고)})</text>`
      return
    }
    s += `<rect x="${x(0)}" y="${y}" width="${x(r.최대오차) - x(0)}" height="18" rx="3" fill="${COLOR[r.판정]}" opacity="0.85"/>`
    s += `<line x1="${x(r.허용오차)}" y1="${y - 4}" x2="${x(r.허용오차)}" y2="${y + 22}" stroke="#24292f" stroke-width="2"/>`
    s += `<text x="${x(r.최대오차) + 6}" y="${y + 11}" class="value">${r.최대오차}</text>`
  })
  return s + '</svg>'
}

// 로그의 오차를 일정 시간 단위로 묶어 최소, 최대 범위를 그립니다.
function errorTrend(result) {
  const file = path.join(LOG_DIR, result.로그파일)
  const { samples } = mapColumns(parseCsv(readText(file)))
  const W = 900
  const H = 260
  const pad = { l: 56, r: 20, t: 16, b: 36 }
  const end = samples.at(-1).time
  const tol = result.허용오차
  const yMax = Math.max(tol * 2, 1)
  const x = t => pad.l + (t / end) * (W - pad.l - pad.r)
  const y = v => pad.t + ((yMax - v) / (yMax * 2)) * (H - pad.t - pad.b)

  // 묶음마다 오차의 최솟값과 최댓값을 구합니다.
  const buckets = new Map()
  for (const s of samples) {
    const key = Math.floor(s.time / BUCKET_SECONDS)
    const e = Math.max(-yMax, Math.min(yMax, s.sensor - s.ref))
    const b = buckets.get(key) ?? { min: e, max: e }
    buckets.set(key, { min: Math.min(b.min, e), max: Math.max(b.max, e) })
  }
  const keys = [...buckets.keys()].sort((a, b) => a - b)
  const top = keys.map(k => `${x(k * BUCKET_SECONDS)},${y(buckets.get(k).max)}`)
  const bottom = keys.reverse().map(k => `${x(k * BUCKET_SECONDS)},${y(buckets.get(k).min)}`)

  let s = `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(result.TC)} 오차 추이">`
  s += `<rect x="${x(0)}" y="${pad.t}" width="${x(SETTLE_SECONDS) - x(0)}" height="${H - pad.t - pad.b}" fill="#f6f8fa"/>`
  // 안정화 띠가 좁으면(긴 로그) 글자를 생략합니다.
  if (x(SETTLE_SECONDS) - x(0) > 48) {
    s += `<text x="${x(SETTLE_SECONDS / 2)}" y="${H - pad.b - 8}" text-anchor="middle" class="muted">안정화</text>`
  }
  for (const v of [tol, -tol]) {
    s += `<line x1="${pad.l}" y1="${y(v)}" x2="${W - pad.r}" y2="${y(v)}" stroke="#cf222e" stroke-dasharray="5 4"/>`
    s += `<text x="${pad.l - 8}" y="${y(v) + 4}" text-anchor="end" class="tick">${v > 0 ? '+' : ''}${v.toFixed(1)}</text>`
  }
  s += `<line x1="${pad.l}" y1="${y(0)}" x2="${W - pad.r}" y2="${y(0)}" stroke="#d0d7de"/>`
  s += `<polygon points="${[...top, ...bottom].join(' ')}" fill="#0969da" opacity="0.35" stroke="#0969da" stroke-width="1"/>`
  // 기록이 끊긴 구간은 세로 띠로 표시합니다.
  for (let i = 1; i < samples.length; i++) {
    const gap = samples[i].time - samples[i - 1].time
    if (gap > MAX_GAP_SECONDS) {
      const gx = x(samples[i - 1].time)
      s += `<rect x="${gx - 2}" y="${pad.t}" width="4" height="${H - pad.t - pad.b}" fill="#cf222e"/>`
      s += `<text x="${gx + 8}" y="${pad.t + 14}" class="alert">기록 끊김 ${gap}초</text>`
    }
  }
  const hours = end >= 7200
  const step = hours ? 3600 : 600
  for (let t = 0; t <= end; t += step) {
    s += `<text x="${x(t)}" y="${H - 12}" text-anchor="middle" class="tick">${hours ? `${t / 3600}시간` : `${t / 60}분`}</text>`
  }
  return s + '</svg>'
}

// 요구사항별로 어떤 시험이 있고 결과가 어떤지 묶습니다.
function traceTable(results) {
  const byReq = new Map()
  for (const r of results) byReq.set(r.요구사항, [...(byReq.get(r.요구사항) ?? []), r])
  const rows = [...byReq].map(([req, list]) => {
    const state = list.some(r => r.판정 === 'Fail') ? 'Fail' : list.every(r => r.판정 === 'Pass') ? 'Pass' : '판정 불가'
    const tcs = list.map(r => `<span class="tag" style="border-color:${COLOR[r.판정]};color:${COLOR[r.판정]}">${esc(r.TC)} ${esc(r.판정)}</span>`).join(' ')
    return `<tr><td>${esc(req)}</td><td>${tcs}</td><td style="color:${COLOR[state]};font-weight:700">${state}</td></tr>`
  })
  return `<table><thead><tr><th>요구사항</th><th>시험 항목</th><th>상태</th></tr></thead><tbody>${rows.join('')}</tbody></table>`
}

if (!fs.existsSync(RESULT_FILE)) {
  console.error(`${RESULT_FILE} 파일이 없습니다. 먼저 node scripts/judge.js를 실행하세요.`)
  process.exit(1)
}
const results = JSON.parse(fs.readFileSync(RESULT_FILE, 'utf8'))
const count = name => results.filter(r => r.판정 === name).length
const fails = results.filter(r => r.판정 === 'Fail')
const today = new Date().toISOString().slice(0, 10)

const html = `<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TS-100 시험 결과 보고 (${today})</title>
<style>
  body { margin: 0; background: #fff; color: #1f2328; font-family: system-ui, -apple-system, 'Segoe UI', 'Malgun Gothic', sans-serif; }
  main { max-width: 960px; margin: 0 auto; padding: 32px 24px 48px; }
  h1 { font-size: 26px; margin: 0 0 4px; }
  h2 { font-size: 19px; margin: 36px 0 12px; }
  .meta { color: #59636e; margin: 0 0 20px; }
  .cards { display: flex; gap: 12px; flex-wrap: wrap; }
  .card { border: 1px solid #d0d7de; border-radius: 8px; padding: 12px 18px; min-width: 110px; }
  .card b { display: block; font-size: 26px; }
  svg { width: 100%; height: auto; display: block; }
  svg text { font-size: 13px; fill: #59636e; }
  svg .label { fill: #1f2328; font-size: 14px; }
  svg .value { fill: #1f2328; font-weight: 700; }
  svg .alert { fill: #cf222e; font-weight: 700; }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { border-bottom: 1px solid #d0d7de; padding: 8px 6px; text-align: left; vertical-align: top; }
  th { background: #f6f8fa; }
  .tag { display: inline-block; border: 1px solid; border-radius: 12px; padding: 1px 8px; margin: 2px 0; font-size: 13px; }
</style>
</head>
<body>
<main>
<h1>TS-100 시험 결과 보고</h1>
<p class="meta">${today} 생성, 기준 docs/test-rules.md, 사양 docs/spec-ts100.md</p>
<div class="cards">
  <div class="card">전체<b>${results.length}</b></div>
  <div class="card" style="color:${COLOR.Pass}">Pass<b>${count('Pass')}</b></div>
  <div class="card" style="color:${COLOR.Fail}">Fail<b>${count('Fail')}</b></div>
  <div class="card" style="color:${COLOR['판정 불가']}">판정 불가<b>${count('판정 불가')}</b></div>
</div>
<h2>최대 오차와 허용 오차</h2>
<p class="meta">막대는 안정화 이후 최대 오차, 검은 세로선은 허용 오차입니다.</p>
${errorBars(results)}
${fails.map(r => `<h2>${esc(r.TC)} ${esc(r.항목)}: ${esc(r.비고)}</h2><p class="meta">${esc(r.근거)}</p>${errorTrend(r)}`).join('\n')}
<h2>요구사항별 결과</h2>
${traceTable(results)}
<h2>판정 결과</h2>
<table>
<thead><tr><th>TC</th><th>항목</th><th>판정</th><th>비고</th><th>근거</th></tr></thead>
<tbody>
${results.map(r => `<tr><td>${esc(r.TC)}</td><td>${esc(r.항목)}</td><td style="color:${COLOR[r.판정]};font-weight:700">${esc(r.판정)}</td><td>${esc(r.비고)}</td><td>${esc(r.근거)}</td></tr>`).join('\n')}
</tbody>
</table>
</main>
</body>
</html>
`

fs.writeFileSync(OUT_FILE, html)
console.log(`보고서 생성: ${OUT_FILE}`)
console.log(`  그래프 ${fails.length + 1}개, Fail ${count('Fail')}건, 판정 불가 ${count('판정 불가')}건`)
