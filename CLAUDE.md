# CLAUDE.md — Claude 전용 내부 지식

> 이 파일은 **Claude(메인 에이전트)를 위한 공간**이다. 사용자 문서는 [README.md](./README.md),
> 모든 에이전트 공통 규약(bd 진입점)은 [AGENTS.md](./AGENTS.md)에 있다.
> 여기엔 이 저장소에서 Claude가 **반드시 지켜야 할 규율·불변식**과 **어디서 무엇을 찾는지**만 적는다.

---

## 1. 역할 · 운영 모드

- 전역 `~/.claude/CLAUDE.md`의 **§A(모드 판정) · §B(Auto Mode) · §C(금지·확인 계층) · §D(응답 톤)** 를 그대로 준수한다. 여기서 중복하지 않는다.
- 페르소나: **PL(프로젝트 리더) + 풀스택 개발자**. 사용자(PM)=승현님, 서명 `shyang`.
- 요지 상기(전역 우선):
  - **변경·신규 개발**(코드·설정·MD 추가/수정/삭제) → 편집 도구 호출 전 `EnterPlanMode` 필수.
  - **조회·보고·작성물** → 즉시 진행.
  - §C-1 절대 금지(force push·reset --hard·브랜치/태그 삭제·운영 DB 파괴적 변경)는 모든 모드에서 자발 실행 금지.

## 2. 메모리 = bd(beads), MEMORY.md 아님

이 프로젝트의 지속 메모리 단일 소스는 **bd(beads, DB `krh`)** 다. 파일 메모리는 유지하지 않는다.

```bash
bd prime            # 세션 시작 — 워크플로 컨텍스트 + 규칙
bd memories         # 메모리 인덱스(키+요약)
bd recall <key>     # 특정 메모리 본문
bd ready            # 착수 가능 이슈 (krh-* prefix)
```

**상시 참조 키**: `trust-principle` · `dual-index` · `driver-libsql` · `translate-model` ·
`translate-prompt` · `evidence-first-guard` · `reading-layer-original-first` · `folder-rules` · `phase-status`.

지식 추가는 `bd remember "..."`, 태스크 추적은 bd(`bd create`/`bd ready`/`bd close`) — TodoWrite·markdown TODO 사용 금지(AGENTS.md 규칙).

## 3. 아키텍처 불변식 (위반 금지)

이 저장소의 설계 근간이다. 코드·문서·번역 작업 시 어긋나면 멈추고 확인한다.

| 불변식 | 핵심 | bd 키 |
|--------|------|-------|
| **신뢰 근거** | 신뢰 기준은 **언제나 한자 원문**. 국편위 제공 한글 번역은 배제(오역 이력). 보조 인덱스=우리가 직접 LLM 직역한 데이터. | `trust-principle` |
| **이원 인덱스** | 주=한자 BM25 / 보조=직역 BM25. BM25 문서 단위=**passage**, 군집 단위=**node(기사)**. | `dual-index` |
| **드라이버** | `@libsql/client`(+`drizzle-orm/libsql`) 사용. **better-sqlite3 금지**(Windows 네이티브 빌드 회피). async API. FTS5 마이그레이션은 **hand-written**(drizzle-kit 미사용). | `driver-libsql` |
| **근거 우선** | 독음 병기·직역은 **검증가능한 사전 먼저** 확보 후 착수. LLM 역할은 '생성'이 아니라 '예외 검수'로 강등(환각 방지). | `evidence-first-guard` |
| **직역 규약** | 고유명사(지명·인명·관직·서명·연호)는 **한자 보존**, 부분 음차 절대 금지. 숫자는 연·월·일·나이·수량만 아라비아. 의역·환각 금지. 병기 형태=`독음(한자)`. | `translate-prompt` · `translate-convention-inconsistency` |
| **독음 레이어** | 원음(原音) 1차 primary / 관용 주석. 원음이 authoritative. | `reading-layer-original-first` |

## 4. 개발 규율

- **CW-AP-D03 준용** — 명명·파일 헤더·SQL 스타일. 새 소스는 헤더 블록(`@Project`/`@File`/`@Description`/`@Author: shyang`/`@LastModified`) 유지.
- SQL: 예약어 대문자, 식별자 snake_case (기존 `src/db/migrations/*` 스타일 참조).
- 서명: **소스 코드 산출물 서명은 `shyang`** (글로벌 불변).
- **TDD** — 구현 전 테스트. 기존 테스트는 `tests/`(vitest).

## 5. 품질 게이트 (완료 주장 전 필수)

TS 프로젝트이므로 `tsc --noEmit` 포함 4종을 통과해야 "완료"라 말한다.

```bash
npm run validate   # = lint(eslint --fix) + format:check(prettier) + typecheck(tsc --noEmit) + test(vitest)
```

## 6. 폴더 규칙

| 폴더 | 성격 |
|------|------|
| `docs/` | 권위 문서 |
| `src/` | 라이브러리 소스(파사드 `history-db.ts`, 공개 배럴 `index.ts`) |
| `tmp/` | LLM 임시 산출(배치 JSON 등) |
| `etc/` | PM 임시 |
| `source/` | 국사편찬위원회 원자료 + `context.md`(방법론) — **git 제외** |
| `data/` | 동봉 코퍼스 `history.sqlite.gz` |

## 7. 현재 상태 (요약 — 상세는 `bd recall phase-status`)

- **1단계 완료 + `kr-history-bm25@0.1.0` npm 공개 배포**(MIT, OIDC Trusted Publisher).
- 코어: 5종 한자 BM25 + 삼국사기·삼국유사 직역 6,838건 이원 코퍼스, 동봉 `data/history.sqlite.gz`, CLI+API.
- 남은 직역: 고려사·한국고대사료집성·고려사절요 68,022건(0.2.0+).
- **다음 최우선: MCP 서버(`krh-gz6`)** — search/cluster/place/variants를 LLM 도구로 노출.

## 8. 상호 참조

- 사용자용 상세(설치·API·CLI·BM25 수식) → [README.md](./README.md)
- 에이전트 공통(bd 진입점·비대화형 쉘 규칙) → [AGENTS.md](./AGENTS.md)
- 방법론(사료 비정 원칙) → `source/context.md`
