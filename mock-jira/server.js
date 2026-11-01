// 연습용 가짜 Jira MCP 서버입니다. Node.js 내장 모듈만 사용합니다.
// 실제 Jira 대신 JSON 파일에 이슈를 저장하고, 실제 서버와 같은 이름의 도구 3개를 제공합니다.
// MCP stdio 방식: 표준 입력으로 한 줄에 하나씩 JSON-RPC 메시지를 받고, 표준 출력으로 답합니다.
import fs from 'node:fs'
import path from 'node:path'
import readline from 'node:readline'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SEED_FILE = path.join(ROOT, 'mock-jira', 'seed.json')
const DATA_FILE = path.join(ROOT, 'output', 'mock-jira.json')
const PROJECTS = ['TS']
const ISSUE_TYPES = ['Epic', 'Story', 'Task', 'Bug']

// 처음 실행하면 seed.json을 복사해서 사용합니다. 처음 상태로 되돌리려면 output/mock-jira.json을 지웁니다.
function load() {
  if (!fs.existsSync(DATA_FILE)) {
    fs.mkdirSync(path.dirname(DATA_FILE), { recursive: true })
    fs.copyFileSync(SEED_FILE, DATA_FILE)
  }
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'))
}
function save(issues) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(issues, null, 2) + '\n')
}

// ----- JQL 일부만 지원하는 해석기 -----
// 지원: field = 값, !=, ~(포함), >=, <=, >, <, in (a, b), not in (a, b), AND, ORDER BY
const FIELDS = {
  project: i => i.key.split('-')[0],
  key: i => i.key,
  issuetype: i => i.issuetype,
  type: i => i.issuetype,
  status: i => i.status,
  statuscategory: i => i.status,
  priority: i => i.priority,
  assignee: i => i.assignee,
  reporter: i => i.reporter,
  labels: i => i.labels,
  summary: i => i.summary,
  description: i => i.description,
  text: i => `${i.summary} ${i.description}`,
  created: i => i.created,
  updated: i => i.updated,
  resolution: i => (i.status === 'Done' ? 'Done' : 'Unresolved')
}
const DATE_FIELDS = ['created', 'updated']

function parseValue(raw) {
  const v = raw.trim()
  if (v.startsWith('(')) return v.slice(1, -1).split(',').map(parseValue)
  return v.replace(/^["']|["']$/g, '')
}

// "2026-10-26" 또는 "-7d", "-2w" 같은 상대 날짜를 시각(ms)으로 바꿉니다.
function toTime(value, endOfDay = false) {
  const rel = /^-(\d+)([dw])$/.exec(value)
  if (rel) return Date.now() - Number(rel[1]) * (rel[2] === 'w' ? 7 : 1) * 86400000
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T00:00:00+09:00` : value)
  if (Number.isNaN(t)) throw new Error(`날짜를 해석할 수 없습니다: ${value}`)
  return endOfDay && /^\d{4}-\d{2}-\d{2}$/.test(value) ? t + 86400000 - 1 : t
}

function parseJql(jql) {
  let where = jql.trim()
  let order = null
  const orderMatch = /\s*ORDER\s+BY\s+(\w+)(?:\s+(ASC|DESC))?\s*$/i.exec(where)
  if (orderMatch) {
    order = { field: orderMatch[1].toLowerCase(), desc: (orderMatch[2] ?? 'ASC').toUpperCase() === 'DESC' }
    where = where.slice(0, orderMatch.index)
  }
  if (/\sOR\s/i.test(where)) throw new Error('이 연습용 서버는 OR를 지원하지 않습니다. AND로만 연결하세요.')
  const conditions = where
    ? where.split(/\s+AND\s+/i).map(part => {
        const m = /^(\w+)\s*(not\s+in|in|!=|>=|<=|=|~|>|<)\s*(.+)$/i.exec(part.trim())
        if (!m) throw new Error(`해석할 수 없는 조건입니다: ${part}`)
        const field = m[1].toLowerCase()
        if (!FIELDS[field]) throw new Error(`지원하지 않는 필드입니다: ${m[1]}`)
        return { field, op: m[2].toLowerCase().replace(/\s+/g, ' '), value: parseValue(m[3]) }
      })
    : []
  return { conditions, order }
}

function matches(issue, { field, op, value }) {
  const actual = FIELDS[field](issue)
  if (DATE_FIELDS.includes(field)) {
    const a = Date.parse(actual)
    if (op === '>=') return a >= toTime(value)
    if (op === '>') return a > toTime(value, true)
    if (op === '<=') return a <= toTime(value, true)
    if (op === '<') return a < toTime(value)
  }
  const same = (a, b) => String(a).toLowerCase() === String(b).toLowerCase()
  const list = Array.isArray(actual) ? actual : [actual]
  if (op === '=') return list.some(a => same(a, value))
  if (op === '!=') return !list.some(a => same(a, value))
  if (op === 'in') return list.some(a => value.some(v => same(a, v)))
  if (op === 'not in') return !list.some(a => value.some(v => same(a, v)))
  if (op === '~') return String(actual).toLowerCase().includes(String(value).toLowerCase())
  throw new Error(`${field} 필드에는 ${op} 연산자를 사용할 수 없습니다`)
}

// 지금 시각을 '2026-10-31T11:20:00+09:00'처럼 지역 시간대로 표시합니다.
function localIsoString(date = new Date()) {
  const offset = -date.getTimezoneOffset()
  const pad = n => String(Math.abs(Math.trunc(n))).padStart(2, '0')
  const local = new Date(date.getTime() + offset * 60000).toISOString().slice(0, 19)
  return `${local}${offset >= 0 ? '+' : '-'}${pad(offset / 60)}:${pad(offset % 60)}`
}

const brief = i => ({
  key: i.key,
  summary: i.summary,
  issuetype: i.issuetype,
  status: i.status,
  priority: i.priority,
  assignee: i.assignee,
  labels: i.labels,
  created: i.created,
  updated: i.updated
})

// ----- 도구 -----
const TOOLS = [
  {
    name: 'jira_search',
    description: 'JQL로 Jira 이슈를 검색합니다. 예: project = TS AND status != Done ORDER BY updated DESC',
    inputSchema: {
      type: 'object',
      properties: {
        jql: { type: 'string', description: 'JQL 검색식. AND, ORDER BY, =, !=, ~, >=, <=, in을 지원합니다' },
        limit: { type: 'number', description: '최대 결과 수 (기본 20, 최대 50)' }
      },
      required: ['jql']
    },
    annotations: { title: 'Jira 이슈 검색', readOnlyHint: true },
    run({ jql, limit = 20 }) {
      const { conditions, order } = parseJql(jql)
      let issues = load().filter(i => conditions.every(c => matches(i, c)))
      if (order) {
        const value = i => {
          const v = FIELDS[order.field]?.(i) ?? ''
          return DATE_FIELDS.includes(order.field) ? Date.parse(v) : String(v)
        }
        issues.sort((a, b) => {
          const [x, y] = order.desc ? [value(b), value(a)] : [value(a), value(b)]
          return typeof x === 'number' ? x - y : x.localeCompare(y)
        })
      }
      return { total: issues.length, issues: issues.slice(0, Math.min(limit, 50)).map(brief) }
    }
  },
  {
    name: 'jira_get_issue',
    description: '이슈 키로 Jira 이슈 하나의 전체 내용을 가져옵니다. 예: TS-103',
    inputSchema: {
      type: 'object',
      properties: { issue_key: { type: 'string', description: '이슈 키 (예: TS-103)' } },
      required: ['issue_key']
    },
    annotations: { title: 'Jira 이슈 조회', readOnlyHint: true },
    run({ issue_key }) {
      const issue = load().find(i => i.key.toUpperCase() === String(issue_key).toUpperCase())
      if (!issue) throw new Error(`이슈를 찾을 수 없습니다: ${issue_key}`)
      return issue
    }
  },
  {
    name: 'jira_create_issue',
    description: 'Jira에 새 이슈를 만듭니다. 만들기 전에 사용자에게 내용을 보여 주고 승인을 받아야 합니다.',
    inputSchema: {
      type: 'object',
      properties: {
        project_key: { type: 'string', description: '프로젝트 키 (예: TS)' },
        summary: { type: 'string', description: '요약(제목)' },
        issue_type: { type: 'string', enum: ISSUE_TYPES, description: '이슈 유형' },
        description: { type: 'string', description: '설명' },
        priority: { type: 'string', enum: ['Highest', 'High', 'Medium', 'Low', 'Lowest'] },
        assignee: { type: 'string', description: '담당자' },
        labels: { type: 'array', items: { type: 'string' } }
      },
      required: ['project_key', 'summary', 'issue_type']
    },
    annotations: { title: 'Jira 이슈 만들기', readOnlyHint: false, destructiveHint: false },
    run({ project_key, summary, issue_type, description = '', priority = 'Medium', assignee = null, labels = [] }) {
      if (!PROJECTS.includes(project_key)) throw new Error(`없는 프로젝트입니다: ${project_key}`)
      if (!ISSUE_TYPES.includes(issue_type)) throw new Error(`이슈 유형은 ${ISSUE_TYPES.join(', ')} 중 하나입니다`)
      const issues = load()
      const next = Math.max(...issues.filter(i => i.key.startsWith(`${project_key}-`)).map(i => Number(i.key.split('-')[1]))) + 1
      const now = localIsoString()
      const issue = {
        key: `${project_key}-${next}`,
        summary,
        description,
        issuetype: issue_type,
        status: 'To Do',
        priority,
        assignee,
        reporter: 'copilot',
        labels,
        created: now,
        updated: now
      }
      save([...issues, issue])
      return { created: brief(issue), note: '연습용 서버라서 output/mock-jira.json 파일에 저장했습니다' }
    }
  }
]

// ----- JSON-RPC 처리 -----
const send = message => process.stdout.write(JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')

function handle(msg) {
  const { id, method, params = {} } = msg
  if (id === undefined) return // notifications/initialized 같은 알림에는 답하지 않습니다
  if (method === 'initialize') {
    return send({
      id,
      result: {
        protocolVersion: params.protocolVersion ?? '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'mock-jira', version: '1.0.0' },
        instructions: '연습용 가짜 Jira입니다. 프로젝트는 TS 하나이며, 이슈를 만들기 전에는 사용자 승인을 받습니다.'
      }
    })
  }
  if (method === 'ping') return send({ id, result: {} })
  if (method === 'tools/list') {
    return send({ id, result: { tools: TOOLS.map(({ run, ...tool }) => tool) } })
  }
  if (method === 'tools/call') {
    const tool = TOOLS.find(t => t.name === params.name)
    if (!tool) return send({ id, error: { code: -32602, message: `없는 도구입니다: ${params.name}` } })
    try {
      const result = tool.run(params.arguments ?? {})
      return send({ id, result: { content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] } })
    } catch (error) {
      // 도구 실행 오류는 모델이 읽고 고칠 수 있도록 결과에 담아서 돌려줍니다.
      return send({ id, result: { content: [{ type: 'text', text: error.message }], isError: true } })
    }
  }
  send({ id, error: { code: -32601, message: `지원하지 않는 메소드입니다: ${method}` } })
}

readline.createInterface({ input: process.stdin }).on('line', line => {
  if (!line.trim()) return
  try {
    handle(JSON.parse(line))
  } catch (error) {
    send({ id: null, error: { code: -32700, message: `JSON 해석 실패: ${error.message}` } })
  }
})
console.error('mock-jira MCP 서버가 시작되었습니다.')
