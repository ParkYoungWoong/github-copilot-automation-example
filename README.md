# github-copilot-automation-example

GitHub Copilot으로 시험 로그 판정, 보고서 작성, Jira 결함 등록을 자동화하는 예제입니다.
가상의 온도 센서 모듈 TS-100의 환경 시험을 배경으로 합니다.

- 필요한 것: VS Code, GitHub Copilot, Node.js 22 이상
- 외부 패키지를 설치하지 않습니다. 모든 스크립트는 Node.js 내장 모듈만 사용합니다.

## 구조

```plaintext
.github/
  copilot-instructions.md     모든 요청에 적용되는 규칙
  skills/
    test-report/              판정, 검증, 보고서, 요약을 이어서 실행 (/test-report)
    defect-issue/             Fail 건을 Jira 결함으로 등록 (/defect-issue)
    weekly-status/            Jira 이슈로 주간 현황 보고
    new-automation/           새 업무의 규칙, 스킬, 검증셋 초안 만들기 (/new-automation)
.mcp.json                     연습용 Jira MCP 서버 등록
data/
  test-cases.csv              시험 항목 8개
  jira-export.csv             MCP를 사용할 수 없을 때 쓰는 Jira 내보내기 파일
  logs/                       시험 로그 (TC-05는 CP949, TC-06은 일부러 없음)
docs/
  spec-ts100.md               제품 사양 (요구사항 ID 포함)
  test-rules.md               판정 규칙
  task-worksheet.md           업무 분해 시트
mock-jira/
  server.js                   연습용 Jira MCP 서버
  seed.json                   처음 이슈 목록
scripts/
  judge.js                    로그 판정 -> output/tc-result.*
  report.js                   그래프 보고서 -> output/test-report.html
  check.js                    검증셋 비교 -> 일치, 오탐, 미탐
tests/cases.json              검증셋
```

## 직접 실행

```bash
node scripts/judge.js
node scripts/report.js
node scripts/check.js
```

## Copilot에게 맡기기

```plaintext
/test-report 이번 주 환경 시험
/defect-issue
이번 주(2026-10-26부터 2026-10-30까지) TS 프로젝트 이슈 현황을 주간 보고로 정리해 줘
/new-automation 자동화할 업무 이름과 설명
```

연습용 Jira는 `output/mock-jira.json`에 저장됩니다.
처음 상태로 되돌리려면 이 파일을 지웁니다.

회사 정책 등으로 MCP를 사용할 수 없으면 `weekly-status`와 `defect-issue` 스킬이 `data/jira-export.csv`를 대신 읽습니다.
이때 결함 이슈는 등록하지 않고 `output/defect-draft.md`에 초안만 저장합니다.
