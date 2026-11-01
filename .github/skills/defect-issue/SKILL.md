---
name: defect-issue
description: 시험 판정 결과의 Fail 건을 Jira 결함 이슈로 등록합니다. 사용자가 /defect-issue로 부를 때만 사용합니다.
argument-hint: TC 번호 (없으면 Fail 전체)
disable-model-invocation: true
---

# 결함 이슈 등록

1. `output/tc-result.md`에서 대상 TC가 Fail인지 확인합니다. Fail이 아니면 등록하지 않고 이유를 알립니다.
1. `jira_search`로 같은 TC의 열린 이슈가 있는지 찾습니다. JQL 예: `project = TS AND summary ~ "TC-03" AND status != Done`
1. 열린 이슈가 있으면 새로 만들지 않고 그 이슈 키를 알려 줍니다.
1. 없으면 아래 형식으로 이슈 초안을 채팅에 보여 주고, 등록해도 되는지 묻습니다.
1. 승인을 받으면 `jira_create_issue`로 등록하고 만들어진 이슈 키를 알려 줍니다.

## 이슈 형식

| 필드 | 값 |
| --- | --- |
| 프로젝트 | TS |
| 유형 | Bug |
| 요약 | `[TC 번호] 항목 비고 (최대 오차 n도, 허용 n도)` |
| 우선순위 | 기록 끊김은 High, 오차 초과는 Medium |
| 레이블 | test-fail |
| 설명 | 시험 항목과 요구사항 ID, 목표 온도와 전원 전압, 판정 근거, 로그 파일과 보고서 경로 |

## 규칙

- 승인 없이 이슈를 만들지 않습니다.
- 설명에는 관찰한 사실만 적고 원인을 추측하지 않습니다.
- 판정 근거는 `output/tc-result.md`의 근거 칸을 그대로 옮깁니다.

## jira 도구를 사용할 수 없을 때

jira 도구가 없으면 `data/jira-export.csv`(Jira에서 내보낸 이슈 목록)를 대신 사용합니다.

- 열린 이슈는 `Summary`에 TC 번호가 들어 있고 `Status`가 Done이 아닌 행으로 찾습니다.
- 이슈를 등록할 수 없으므로 승인을 묻지 않고, 초안을 `output/defect-draft.md`에 저장한 뒤 Jira에 직접 등록하라고 안내합니다.
