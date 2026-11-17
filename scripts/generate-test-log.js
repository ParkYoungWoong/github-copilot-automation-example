// 실행: node scripts/generate-test-log.js → output/synthetic-test-log.csv
import { mkdirSync, writeFileSync } from 'node:fs'

const outputDir = new URL('../output/', import.meta.url)
const outputFile = new URL('synthetic-test-log.csv', outputDir)
const rows = ['time_s,ref_c,sensor_c,supply_v']

for (let timeS = 0; timeS <= 600; timeS += 1) {
  if (timeS >= 300 && timeS < 315) continue

  const refC = 22.5 - 62.5 * Math.cos(Math.PI * timeS / 450)
  const sensorC = Math.max(-40, Math.min(85, refC + 0.3 + 0.5 * Math.sin(timeS / 9)))
  const supplyV = 3.3 + 0.3 * Math.cos(Math.PI * timeS / 240)

  rows.push(`${timeS},${refC.toFixed(2)},${sensorC.toFixed(2)},${supplyV.toFixed(3)}`)
}

mkdirSync(outputDir, { recursive: true })
writeFileSync(outputFile, `${rows.join('\n')}\n`, { flag: 'wx' })
console.log(`합성 CSV 생성: ${outputFile.pathname}`)
