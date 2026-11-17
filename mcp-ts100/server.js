import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'
import { judge, parseCsv, readText } from '../scripts/judge.js'

const ROOT = fileURLToPath(new URL('../', import.meta.url))
const TEST_CASES = path.join(ROOT, 'data', 'test-cases.csv')

function testCases() {
  return parseCsv(readText(TEST_CASES))
}

const TOOLS = [
  {
    name: 'ts100_list_results',
    description: '시험 판정을 실행하여 TC별 판정과 비고를 반환합니다.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
    annotations: { title: 'TS-100 시험 판정 목록', readOnlyHint: true },
    run() {
      return testCases().map(tc => {
        const result = judge(tc)
        return { TC: result.TC, 판정: result.판정, 비고: result.비고 }
      })
    }
  },
  {
    name: 'ts100_get_result',
    description: 'TC 번호로 시험 판정을 실행하여 판정, 비고, 근거를 반환합니다.',
    inputSchema: {
      type: 'object',
      properties: { tc: { type: 'string', minLength: 1, description: 'TC 번호 (예: TC-01)' } },
      required: ['tc'],
      additionalProperties: false
    },
    annotations: { title: 'TS-100 시험 판정 조회', readOnlyHint: true },
    run({ tc }) {
      if (typeof tc !== 'string' || !tc.trim()) throw new Error('TC 번호를 입력해야 합니다.')
      const testCase = testCases().find(item => item.TC === tc)
      if (!testCase) throw new Error(`시험 항목을 찾을 수 없습니다: ${tc}`)
      const result = judge(testCase)
      return { TC: result.TC, 판정: result.판정, 비고: result.비고, 근거: result.근거 }
    }
  }
]

const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')

function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) {
    return send({ id: null, error: { code: -32600, message: '잘못된 요청입니다.' } })
  }
  const { id, method, params = {} } = msg
  if (id === undefined) return
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    return send({ id, error: { code: -32602, message: '요청 매개변수는 객체여야 합니다.' } })
  }
  if (method === 'initialize') {
    return send({
      id,
      result: {
        protocolVersion: params.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'ts100', version: '1.0.0' }
      }
    })
  }
  if (method === 'ping') return send({ id, result: {} })
  if (method === 'tools/list') return send({ id, result: { tools: TOOLS.map(({ run, ...tool }) => tool) } })
  if (method === 'tools/call') {
    const tool = TOOLS.find(item => item.name === params.name)
    if (!tool) return send({ id, error: { code: -32602, message: `없는 도구입니다: ${params.name}` } })
    try {
      const args = params.arguments ?? {}
      if (typeof args !== 'object' || Array.isArray(args)) throw new Error('도구 인자는 객체여야 합니다.')
      if (Object.keys(args).some(key => !Object.hasOwn(tool.inputSchema.properties, key))) {
        throw new Error('지원하지 않는 도구 인자가 있습니다.')
      }
      const result = tool.run(args)
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } })
    } catch (error) {
      return send({ id, result: { content: [{ type: 'text', text: error.message }], isError: true } })
    }
  }
  send({ id, error: { code: -32601, message: `지원하지 않는 메소드입니다: ${method}` } })
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return
  let message
  try {
    message = JSON.parse(line)
  } catch (error) {
    return send({ id: null, error: { code: -32700, message: `JSON 해석 실패: ${error.message}` } })
  }
  handle(message)
})
