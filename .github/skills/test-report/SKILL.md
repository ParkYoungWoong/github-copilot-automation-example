---
name: test-report
description: 시험 로그를 판정하고 그래프가 들어간 보고서와 요약을 만듭니다. 사용자가 /test-report로 부를 때만 사용합니다.
argument-hint: 보고 대상이나 강조할 내용
disable-model-invocation: true
---

# 시험 결과 보고

아래 순서를 그대로 따릅니다.

1. `node scripts/check.js`를 실행합니다. 불일치가 있으면 보고서를 만들지 말고, 어긋난 TC와 확인 항목만 알린 뒤 멈춥니다.
1. `node scripts/judge.js`를 실행합니다.
1. `node scripts/report.js`를 실행합니다.
1. `output/tc-result.md`를 읽고 아래 형식으로 `output/test-summary.md`를 작성합니다.
1. 마지막에 `output/test-report.html`을 열어 그래프를 확인하라고 안내합니다.

## 요약 형식

```markdown
# TS-100 시험 결과 요약 (YYYY-MM-DD)

## 결과

전체 n건: Pass n, Fail n, 판정 불가 n

## Fail

| TC | 항목 | 비고 | 근거 | 확인할 것 |
| --- | --- | --- | --- | --- |

## 판정 불가

| TC | 항목 | 비고 | 필요한 조치 |
| --- | --- | --- | --- |

## 다음 조치

- 항목마다 한 줄
```

## 규칙

- 표의 숫자와 근거는 `output/tc-result.md`에서 그대로 옮깁니다.
- 직접 작성하는 것은 '확인할 것', '필요한 조치', '다음 조치'뿐입니다.
- '확인할 것'에는 원인을 단정하지 말고 무엇을 확인하면 되는지 적습니다.
