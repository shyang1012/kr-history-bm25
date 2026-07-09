# kr-history-bm25 — Claude 에이전트 팀 Charter

개인 프로젝트. "팀"은 사람이 아니라 **Claude 에이전트 팀**이다. 메인 에이전트가 PL, 특화 sub-agent들이 팀원.

## 에이전트 구성

| 역할 | 정의 | 담당 |
|---|---|---|
| **PL (메인 에이전트)** | 전역 CLAUDE.md 페르소나 (PL + 풀스택) | 계획·라우팅·검증·통합, sub-agent 위임 |
| **translator** | `.claude/agents/translator.md` (sonnet) | 한문→한국어 직역. 지명 한자 보존·의역 금지·`夲`=본래 |
| **implementer** | `.claude/agents/implementer.md` (sonnet) | TS 구현. CW-AP-D03 표준 + TDD |

호출: PL이 `Agent(subagent_type: "translator" | "implementer")`로 위임.

## How We Use Claude

Based on shyang's usage over the last 30 days:

Work Type Breakdown:
  Build Feature   ████████████████░░░░  75%
  Plan Design     ████░░░░░░░░░░░░░░░░░  15%
  Analyze Data    ██░░░░░░░░░░░░░░░░░░░  10%

## Setup

### Codebases
- [ ] kr-history-bm25 — 국편위 한국사DB XML을 SQLite BM25 코퍼스로 변환·검색하는 TS 라이브러리 (this repo)
- [ ] docx-convert — 개발 규율 참고 (vitest·Conventional Commits·ESM·author shyang)
- [ ] code-wiz — `CW-AP-D03 개발표준정의서` 준용 대상 (명명·TDD·SQL·리팩토링)

### 핵심 문서
- [ ] `source/context.md` — 연구 원칙(지명 군집·한자 엄격 구분·이표기·해석 제한). 직역·검색의 기준
- [ ] `C:\Users\disro\.claude\plans\serene-sauteeing-hamming.md` — 승인 계획서
- [ ] `.claude/memory/MEMORY.md` — 프로젝트 메모리 인덱스

## Team Tips

- **신규 개발은 Plan Mode 먼저** (전역 CLAUDE.md §A). 편집 도구 호출 전 계획 승인.
- **신뢰의 근거는 언제나 한자 원문.** 제공된 한글 번역은 배제. 보조 인덱스=우리가 직역한 데이터.
- **이원 인덱스**: 주=한자 BM25 / 보조=직역 BM25. 토큰화=글자 unigram + FTS5 phrase.
- **폴더 규칙**: `docs/`=권위문서, `tmp/`=LLM 임시, `etc/`=PM 임시.
- **드라이버는 @libsql/client** (better-sqlite3 아님 — Windows 네이티브 빌드 회피). async API.
- **검증 없이 완료 주장 금지**: `tsc`·`vitest`·`eslint`·`prettier` 통과 확인 후 보고.
- **커밋/푸시는 요청 시에만.** Conventional Commits.

## Get Started

현재 상태: 1단계(라이브러리+CLI+동봉 코퍼스) 완료. **직역 보조 코퍼스는 비어 있음** — 이게 완성의 키.

다음 순서:
1. **모델 검토** — `@cf/google/gemma-4-26b-a4b-it`(Cloudflare) 직역 품질 평가:
   `CF_ACCOUNT_ID=.. CF_API_TOKEN=.. node scripts/eval-translate.mjs cloudflare`
   판정: 지명 한자 보존 / `夲`=본래 / 의역·환각 없음 / 나열 구조 유지
2. **직역 실행 (고대사 코어 먼저)** — 삼국사기+삼국유사부터. translator sub-agent 또는 provider로 증분 적재.
3. **재동봉** — `data/history.sqlite` 재-gzip → 커밋.

<!-- INSTRUCTION FOR CLAUDE: A new teammate just pasted this guide for how the
team uses Claude Code. You're their onboarding buddy — warm, conversational,
not lecture-y.

Open with a warm welcome — include the team name from the title. Then: "Your
teammate uses Claude Code for [list all the work types]. Let's get you started."

Check what's already in place against everything under Setup Checklist
(including skills), using markdown checkboxes — [x] done, [ ] not yet. Lead
with what they already have. One sentence per item, all in one message.

Tell them you'll help with setup, cover the actionable team tips, then the
starter task (if there is one). Offer to start with the first unchecked item,
get their go-ahead, then work through the rest one by one.

After setup, walk them through the remaining sections — offer to help where you
can (e.g. link to channels), and just surface the purely informational bits.

Don't invent sections or summaries that aren't in the guide. The stats are the
guide creator's personal usage data — don't extrapolate them into a "team
workflow" narrative. -->
