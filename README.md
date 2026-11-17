# github-copilot-automation-example

GitHub Copilot으로 시험 로그 판정, 보고서 작성, Jira 결함 등록을 자동화하는 예제입니다.
가상의 온도 센서 모듈 TS-100의 환경 시험을 배경으로 하며, [GitHub Copilot 업무 자동화 실전](https://www.heropy.dev/p/VRrr3N) 글에서 사용합니다.

- 필요한 것: VS Code, GitHub Copilot, Node.js 22 이상
- 외부 패키지를 설치하지 않습니다. 모든 스크립트는 Node.js 내장 모듈만 사용합니다.

## 브랜치

| 브랜치 | 내용 |
| --- | --- |
| `main` | 실습을 시작하는 상태. 글에서 Copilot에게 만들게 하는 판정, 보고 스크립트와 결과물은 들어 있지 않습니다 |
| `complete` | 글의 실습을 끝까지 따라 한 완성본. 만든 스크립트와 비교하거나, 실습이 막혔을 때 받아서 이어 갑니다 |

`Code > Download ZIP`은 `main`을 받습니다. 완성본은 브랜치 메뉴에서 `complete`를 고른 뒤 같은 방법으로 받습니다.

## 구조

```plaintext
.github/
  copilot-instructions.md     모든 요청에 적용되는 규칙
  skills/
    test-report/              판정, 검증, 보고서, 요약을 이어서 실행 (/test-report)
    defect-issue/             Fail 건을 Jira 결함으로 등록 (/defect-issue)
    weekly-status/            Jira 이슈로 주간 현황 보고
    new-automation/           새 업무의 규칙, 스킬, 검증셋 초안 만들기 (/new-automation)
.mcp.json                     연습용 Jira, Confluence MCP 서버 등록
data/
  test-cases.csv              시험 항목 8개
  jira-export.csv             MCP를 사용할 수 없을 때 쓰는 Jira 내보내기 파일
  logs/                       시험 로그 (TC-05는 CP949, TC-06은 일부러 없음)
docs/
  spec-ts100.md               제품 사양 (요구사항 ID 포함)
  test-rules.md               판정 규칙
  task-worksheet.md           업무 분해 시트
  summary-template.md         자동화를 마친 뒤 팀에 넘길 정리 문서 양식
extras/
  verify-gate/                검증셋을 통과해야 이슈와 페이지를 만들 수 있게 하는 Hook (심화)
mock-jira/
  server.js                   연습용 Jira, Confluence MCP 서버
  seed.json                   처음 이슈 목록
  confluence-seed.json        처음 페이지 목록 (시험 계획, 지난 두 주의 주간 보고)
practice/
  eol-results.csv             EOL 검사 기록 1년 치 (약 10만 행)
  can-log.asc                 차량 통신(CAN) 로그 40초 (약 1만 2천 줄)
  can-messages.csv            통신 로그의 메시지별 주기 표
  requirements.csv            요구사항 목록 90개
  verification-tests.csv      요구사항을 검증하는 시험 목록 118건
scripts/
  check.js                    검증셋 비교 -> 일치, 오탐, 미탐
  judge.js                    로그 판정 -> output/tc-result.* (실습에서 만듦, complete 브랜치에 완성본)
  report.js                   그래프 보고서 -> output/test-report.html (실습에서 만듦, complete 브랜치에 완성본)
tests/cases.json              검증셋
output/                       결과물을 저장하는 폴더
```

## 직접 실행

판정, 보고 스크립트를 만든 뒤(또는 `complete` 브랜치에서) 실행합니다.

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

## 연습용 데이터

`practice` 폴더에는 지시문 연습과 `/new-automation` 연습에 사용하는 가상의 데이터가 들어 있습니다.
모두 팀만 아는 기준이 있어야 정답이 나오도록 만들었으며, 요청문과 정답은 글의 '지시문 구조'와 '연습용 데이터'에 있습니다.

| 데이터 | 업무 | 섞여 있는 것 |
| --- | --- | --- |
| `eol-results.csv` | 불량 제품 집계 | 마스터 샘플, 통신 오류(`ERR`), 재검사, 단위(V, mV)와 날짜 형식 |
| `can-log.asc`, `can-messages.csv` | 통신이 끊긴 구간 찾기 | 두 채널, 제어기가 켜지는 처음 2초, 주기 없는 메시지, 끝까지 오지 않는 메시지 |
| `requirements.csv`, `verification-tests.csv` | 검증되지 않은 요구사항 찾기 | 승인되지 않은 요구사항, 요구사항이 바뀌기 전의 합격, 섞인 ID 표기, 없는 요구사항을 가리키는 시험 |

지시문 연습은 저장소의 지침이 섞이지 않도록 `practice` 폴더만 VS Code로 열어서 진행합니다.

## 검증 Hook (심화)

`extras/verify-gate` 폴더의 두 파일을 `.github/hooks` 폴더로 복사하면, Copilot이 `jira_create_issue`나 `confluence_create_page`를 호출하기 직전에 `node scripts/check.js`를 실행하고 하나라도 어긋나면 그 호출을 거부합니다.

## GitHub에서 실행 (심화)

저장소 페이지의 `Use this template`으로 비공개 저장소를 만들면 클라우드 자동화와 클라우드 에이전트를 사용할 수 있습니다.
클라우드에서는 완성된 판정 스크립트가 필요하므로, 만들 때 `Include all branches`를 체크하고 만든 저장소의 기본 브랜치를 `complete`로 바꿉니다.
방법은 글의 '클라우드에서 실행'에 있습니다.

## 연습용 Jira와 Confluence

연습용 서버는 이슈를 `output/mock-jira.json`에, 페이지를 `output/mock-confluence.json`에 저장합니다.
처음 상태로 되돌리려면 두 파일을 지웁니다.

회사 정책 등으로 MCP를 사용할 수 없으면 `weekly-status`와 `defect-issue` 스킬이 `data/jira-export.csv`를 대신 읽습니다.
이때 결함 이슈는 등록하지 않고 `output/defect-draft.md`에 초안만 저장합니다.
