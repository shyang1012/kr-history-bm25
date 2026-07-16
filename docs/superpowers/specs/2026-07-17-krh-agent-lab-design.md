# krh-agent-lab — "작은 온디바이스 모델 + 한자 RAG" 역사 에이전트 실험 설계

- **작성일**: 2026-07-17
- **작성자**: shyang
- **상태**: 설계 승인 대기 (브레인스토밍 산출물)
- **관련 bd**: `2026-07-12-pm-kr-history-bm25-rag` · `data-driven-insight` · `evidence-first-guard` · `trust-principle` · `dual-index`
- **참조 코드**: `D:\dev\devApps\code-wiz\code-wiz_worker\src\tooluse\*` (재활용 원본), `src/mcp/tools.ts`, `src/history-db.ts`

---

## 1. 요약

Gemma 4 E2B(약 2.3B effective, 온디바이스 멀티모달, Apache 2.0)에 `kr-history-bm25`의 한자 사료 검색·군집 도구를 붙여, **소형 모델이 한자 원문 근거로 얼마나 잘 답하는가**를 검증하는 실험 애플리케이션이다. 소형 모델이 스스로 도구를 호출하고 도구가 돌려준 원문을 근거로 답하게 하여, "도구 없는 LLM = 환각 / 도구 붙은 LLM = 근거 제시"의 **before/after** 대비를 눈으로 보인다.

이 프로젝트의 정체성(`2026-07-12-pm...rag`: "설치형·오프라인 도메인 RAG, 해자=모델이 아니라 신뢰 코퍼스")과 정합하며, 라이브러리 코어는 **일절 수정하지 않는다**. 산출물은 라이브러리를 소비하는 예시 겸 실험 하네스로서 `examples/agent-lab/`에 둔다.

## 2. 배경·동기·가설

- **동기**: 관리형 텍스트 LLM 통합(CF Workers AI 등)은 이미 경험이 충분하다. 새 탐구 가치는 **경량 멀티모달 에이전트를 제품에 번들**하는 형태와, **작은 모델 + 지식베이스(RAG)의 실제 성능**에 있다.
- **가설(H1)**: 2B급 온디바이스 모델도 잘 설계된 도구 계약(OpenAI 호환 function calling)과 근거 접지가 주어지면, 한자·고유명사 도메인에서 파라미터 지식만으로 답할 때보다 유의미하게 정확·검증가능한 답을 낸다.
- **핵심 리스크(R1)**: 소형 E2B가 `tool_calls`를 OpenAI 포맷으로 **안정적으로 출력**하는지가 관문이다(코드위즈는 26B급 + 서버 function calling이라 이 리스크가 낮았음). 1단계는 바로 이 리스크를 싸게 검증한다.

## 3. 목표 · 비목표

### 목표 (1단계)
- kr-history-bm25 도구를 붙인 E2B 에이전트가 대표 질의셋에서 **도구를 자율 호출 → 원문 근거로 답변**하는 것을 실증한다.
- before/after(도구 미사용 vs 사용) 차이를 **정성·정량으로 기록**한다.
- 코드위즈 tool-use 오케스트레이션 자산을 **모델 백엔드 무관하게** 재활용할 수 있음을 검증한다.

### 비목표 (YAGNI — 후속 단계로 분리)
- 멀티모달(이미지) 접지 → **1.5단계**.
- 브라우저 in-browser 번들(transformers.js+WebGPU)·before/after 데모 웹앱 UI → **2단계**.
- 원격 MCP·호스팅(`krh-0ny`)과의 통합.
- 다국어 페르소나, 세션 영속화, 인증·과금.

## 4. 범위 · 단계 로드맵

| 단계 | 내용 | 게이트 |
|------|------|--------|
| **1단계 (본 스펙 집중)** | Ollama `gemma4:e2b` + 재활용 orchestrator + kr-history 도구(in-process) — **텍스트 tool calling 검증** | §9 성공 기준 |
| 1.5단계 | 멀티모달 접지 — 고지도·한자 이미지 판독 → 코퍼스 교정 | 1단계 통과 시 착수 |
| 2단계 | 브라우저 in-browser 번들 + before/after 데모 웹앱 | 1.5 검증 후 별도 스펙 |

**착수 0스텝(모델 가용성 검증)**: 실험 전체가 모델 실재에 걸려 있으므로(R1이 관문), 계획 착수 1차로 `ollama pull gemma4:e2b` 태그와 HF 카드(`google/gemma-4-E2B-it`) 실재를 확인한다. (2026-07-17 확인: Ollama `gemma4:e2b`·`gemma4:e2b-it-q4_K_M`, HF `google/gemma-4-E2B-it` 존재 — Gemma 3n E2B와 별개 계열.) 가용성 미확인 시 모델명·링크 정정.

## 5. 아키텍처

### 5.1 재활용 vs 신규 경계

**결정적 통찰**: 코드위즈 `orchestrator.ts`는 `ModelCaller` 인터페이스로 **의존성 역전(DIP)** 되어 있어 모델 백엔드를 직접 import하지 않는다. 따라서 **멀티라운드 루프·예산·leak strip 골격은 그대로 이식**한다. 단 신규 작업은 하나가 아니라 **셋**이다:

- **신규 ①** `ModelCaller` 구현체 = Ollama 어댑터(§6.1)
- **신규 ②** kr-history 도구 래핑(§6.2)
- **신규 ③** **근거 접지 검증기**(§6.5) — 코드위즈의 환각검출은 `extractUrls()` + `ctx.provided.map(s => s.url)`로 **URL exact-match 전용**(orchestrator.ts line 27–34, 230–239)이다. 우리 도메인엔 URL이 없고 근거는 passage id·한자 surface이므로, 오케스트레이터 코어의 URL 추출·비교 블록을 **passage id/surface 접지 검증기로 치환**한다. surface는 부분열이 본문에 자연 등장할 수 있어(fuzzy) 검출 방식 정의 자체가 설계 결정이다.

```
┌─ 재활용 (code-wiz/src/tooluse에서 이식) ─────────────┐
│ orchestrator.ts   멀티라운드 루프 (callModel ↔ tool)   │
│ registry.ts       ToolSpec · ToolContext · BudgetTracker│
│ types.ts          ChatMessage·ToolCall·ModelTurn (OpenAI 호환)│
│ sanitizeToolLeak  가드레일: 내부 도구 leak strip        │
│ (환각검출 골격은 재활용하되 URL→근거접지로 치환 = 신규③)│
└───────────────┬─────────────────────────────────────┘
                │ ModelCaller (OpenAI 호환 계약)   ← 🆕 신규 ①
                ▼
         OllamaModelCaller
         (POST /v1/chat/completions → ModelTurn 변환)
                │ 도구 호출
                ▼
   kr-history 도구 (ToolSpec) ──in-process──▶ HistoryDb 파사드
   search_han·search_ko·cluster·lookup_place·with_variants …
     🆕 신규 ②(래핑) / 재활용(파사드)
                │ 근거 축적 → ctx.provided {passageId, hanSurface}
                ▼
   근거 접지 검증기 GroundingChecker   ← 🆕 신규 ③ (§6.5)
```

### 5.2 데이터 흐름 (1턴 예: "낙랑은 평양이었나?")

1. 페르소나(system) + 질의(user) → orchestrator 루프 진입.
2. `callModel`(=OllamaModelCaller)이 E2B에 messages + tools(function schema) 전달.
3. E2B가 `tool_calls: [search_han(樂浪), cluster(樂浪)]` 반환.
4. orchestrator가 `ToolSpec.handler` 실행 → HistoryDb 파사드 in-process 호출 → 결과를 `role:tool`로 누적. 통과 출처는 `ctx.provided`에 축적.
5. E2B가 도구 결과로 최종 답변 생성(원문 id 인용).
6. orchestrator가 근거접지 검증(§6.5, id 인용 대조)·leak strip 후 `finalText` 반환.

### 5.3 도구 접근 방식 — MCP 아닌 in-process

`src/mcp/tools.ts`는 `HistoryDb` 파사드에 1:1 매핑하는 얇은 어댑터다. 같은 저장소 안 실험이므로 MCP transport(stdio/HTTP)를 거치지 않고 **`HistoryDb`를 직접 `ToolSpec`으로 래핑**한다. 도구 스키마(설명·파라미터)는 `src/mcp/tools.ts`의 기존 정의를 참조·재사용해 계약 일관성을 유지한다. (원격 MCP는 2단계/`krh-0ny`에서.)

## 6. 컴포넌트 상세

### 6.1 `OllamaModelCaller` (신규, 얇음)
- 시그니처: `ModelCaller = (messages, tools) => Promise<ModelTurn>`.
- 구현: `POST http://localhost:11434/v1/chat/completions` (OpenAI 호환), body에 `messages`·`tools`·`tool_choice:'auto'`·`model:'gemma4:e2b'`. 응답의 `choices[0].message`를 `ModelTurn`(content·toolCalls·usage)으로 변환.
- Ollama base URL·모델명은 환경변수/설정으로 주입(DIP 유지).

### 6.2 kr-history 도구 래핑 (신규, 얇음)
- 각 도구 = `ToolSpec` 1개: `name`·`description`·`parameters`(기존 zod/JSON schema 재사용)·`cost`(in-process라 0 또는 명목)·`handler`(HistoryDb 파사드 호출).
- 1단계 도구셋(텍스트): `search_han`·`search_ko`·`search_hybrid`·`search_by_reading`·`lookup_place`·`cluster`·`with_variants`·`place_clusters`.
- `ctx.provided`에 근거(원문 passage id·surface)를 push → 근거접지 검증(§6.5)의 offered 집합.

### 6.3 페르소나·프롬프트
- `trust-principle`·`source/context.md` 정합: **근거 없이 단정 금지, 도구 결과로만 답, 원문 id 인용, 확정 표현 회피(‘~라는 견해/드러난다’)**.
- 통설 오프레이밍 방지 지침(`discovery-*` 메모리의 낙랑·遼水 사례 정신) 반영.

### 6.4 재활용 이식 모듈
- `orchestrator.ts`·`registry.ts`·`types.ts`·`sanitizeToolLeak.ts`를 `examples/agent-lab/`로 복사 이식하되, code-wiz 고유 의존(`SourceItem`·`WorkersAiClient`·CRDB 도구)은 제거/치환. 이식 시 헤더 블록에 출처(code-wiz cw-owt9)·이식일 명시.
- orchestrator의 URL 기반 환각검출 블록(`URL_RE`·`extractUrls`·`offeredUrls`/`citedUrls`/`hallucinatedUrls`)은 **제거**하고 §6.5 검증기 호출로 대체. `ToolUseMetrics`의 URL 필드는 kr-history 접지 지표(§6.5)로 치환한다.

### 6.5 근거 접지 검증기 `GroundingChecker` (신규 ③ — 실험 측정의 핵심)
코드위즈 환각검출은 URL exact-match 전용이라 우리 도메인엔 부적합. 대체 설계:
- **offered(근거 집합)**: 각 도구 handler가 `ctx.provided`에 push하는 근거 = `{ passageId, hanSurface }`. (code-wiz `SourceItem`을 kr-history용 `Evidence` 타입으로 재정의.)
- **cited 추출 — 구조적 인용 우선**: 페르소나가 답변에서 근거를 **명시적 `[id]` 토큰**으로 인용하도록 강제(§6.3 프롬프트). `finalText`에서 `[id]`를 추출해 offered id 집합과 **exact match** → 미접지 id = 환각 후보(자동 지표).
- **보조 — surface 접지(정성)**: 답변에 등장한 한자 지명이 offered `hanSurface` 집합에 포함되는지 점검. 한자 부분열이 본문에 자연 등장할 수 있어(fuzzy) **자동 차단이 아니라 정성 라벨**로만 기록.
- 즉 **자동 지표(id 인용 접지율) + 정성 검토(사실주장 접지)를 분리**해 §8 성공기준 #3을 측정가능하게 만든다. 검증기는 순수 함수(문자열 in → 지표 out)로 단위 테스트 가능.

## 7. 디렉토리 구조

```
examples/agent-lab/
  README.md               # 실행법(ollama pull gemma4:e2b), 실험 목적
  package.json            # 워크스페이스 예시 (kr-history-bm25 의존)
  src/
    ollama-caller.ts      # OllamaModelCaller (신규)
    tools.ts              # HistoryDb → ToolSpec 래핑 (신규)
    persona.ts            # 페르소나 프롬프트 (신규)
    orchestrator/         # 코드위즈 이식(재활용): orchestrator·registry·types·sanitize
    run.ts                # CLI 진입 — 질의 1건 실행, before/after 출력
  eval/
    queries.json          # 대표 질의셋 (낙랑·遼水·압록 등)
    report.ts             # 성공 기준 측정·기록
  tests/                  # vitest — 단위 + e2e(실 Ollama)
```

## 8. 1단계 성공 기준

1. **도구 자율 호출**: E2B가 대표 질의에서 적절한 도구를 스스로 호출한다(`tool_calls` 안정 출력, JSON 파싱 실패율 목표 < 10%).
2. **근거 기반 답변**: 도구 결과를 사용해 답하고, 원문 id/surface를 인용한다.
3. **근거 접지(핵심)**: 답변의 핵심 사실 주장이 `ctx.provided` 근거에 접지된다. 측정 = ① 자동 — 답변이 인용한 `[id]`가 offered id에 존재(미접지 id율 목표 0) · ② 정성 — 답변의 지명·수치 주장이 offered `hanSurface`/passage에 등장(날조 없음). 검증 방식은 §6.5.
4. **대표 질의셋 통과**: 낙랑·遼水·압록 등 `discovery-*` 메모리 사례에서 도구 경유 답이 통설 단정 없이 공기 지명군을 근거로 제시.
5. **before/after 기록**: 도구 미사용(파라미터 지식만) 대비 개선을 정성 예시 + 정량 지표(환각 건수·인용률·도구호출 성공률)로 문서화.

## 9. 실험 설계 (before/after)

- **질의셋**: `eval/queries.json` — discovery 메모리 실측 시드 기반(낙랑 공기군, 遼水/遼河 용법차, 鴨綠 지명화석 등) + 일반 사료 질의.
  - ※ **코퍼스 커버리지 전제**: `search_ko`·`search_hybrid`는 번역 완료 코퍼스(sg/sy = 삼국사기·삼국유사)에서만 동작한다. 시드는 sg/sy 범위 내로 선정해 코퍼스 미커버리지를 도구선택 실패로 오인하지 않는다. `search_han`은 전체 한자 코퍼스에서 동작.
- **A조건(before)**: 도구 없이 E2B 단독 답변.
- **B조건(after)**: 동일 질의를 agent-lab(도구 붙임)으로.
- **측정**(§6.5 지표): 도구호출 성공률, `[id]` 인용률, 미접지 id율(자동 환각 지표), surface 접지 정성 라벨. `eval/report.ts`가 표로 산출.

## 10. 테스트 · 품질 게이트

- **TDD**: 각 신규 모듈(ollama-caller·tools·persona) 단위 테스트 선작성(vitest). ModelCaller는 mock 응답으로 orchestrator 배선 검증.
- **e2e**: 실제 Ollama(`gemma4:e2b`) 기동 후 대표 질의 1~2건으로 tool calling·근거 접지 계약 검증. (Ollama 미가용 환경에선 skip 태깅.)
- **게이트**: 루트 `npm run validate`(lint·format:check·tsc·vitest) 통과. **경계 확정** — agent-lab의 **lint·typecheck·단위 테스트는 루트 게이트에 포함**하고, **e2e(실 Ollama)만 환경 미가용 시 skip 태깅**으로 런타임 격리한다(§11 R3의 '격리'는 e2e 런타임 격리를 뜻하며 정적 검사 포함과 상충하지 않는다).

## 11. 리스크 · 완화

| 리스크 | 완화 |
|--------|------|
| R1: E2B `tool_calls` 불안정 | 1단계가 곧 이 검증. 실패 시 프롬프트 하드닝·few-shot·도구 수 축소로 반복. 그래도 안 되면 가설 반증으로 기록(실험의 정직한 산출). |
| R2: 이식 시 code-wiz 의존 누수 | `SourceItem`·`WorkersAiClient` 등 치환 목록을 이식 체크리스트로 관리. |
| R3: 예시 패키지가 루트 게이트 오염 | 워크스페이스 경계·tsconfig 분리로 격리. |
| R4: in-process 도구가 라이브러리 내부에 결합 | 공개 파사드(`HistoryDb`/배럴 `index.ts`)만 사용, 내부 모듈 직접 참조 금지. |

## 12. 후속 (별도 스펙)

- **1.5단계**: 멀티모달 — 이미지 입력(고지도·금석문·한자 필사) → E2B 판독 → 코퍼스 교정 데모.
- **2단계**: 브라우저 in-browser 번들(transformers.js+WebGPU), before/after 데모 웹앱 UI, 배포·전파.

## 13. 참조

- Gemma 4 E2B: [HF 모델카드](https://huggingface.co/google/gemma-4-E2B-it) · [Ollama gemma4:e2b](https://ollama.com/library/gemma4:e2b) · [Function calling with Gemma 4](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4) · [WebGPU/transformers.js](https://huggingface.co/blog/gemma4)
- 재활용 원본: code-wiz `src/tooluse/{orchestrator,registry,types,sanitizeToolLeak}.ts`
- 라이브러리 표면: `src/history-db.ts`(파사드), `src/mcp/tools.ts`(도구 계약)
