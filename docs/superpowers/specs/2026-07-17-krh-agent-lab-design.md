# krh-agent-lab — 작은 LLM 범용 에이전트 하네스 (call_mcp / run_cli) 설계

- **작성일**: 2026-07-17 (v2 — 범용 메타도구로 재구성)
- **작성자**: shyang
- **상태**: 설계 승인 대기 (브레인스토밍 산출물)
- **관련 bd**: `krh-izc` · `2026-07-12-pm-kr-history-bm25-rag` · `data-driven-insight` · `evidence-first-guard` · `trust-principle`
- **참조 코드**: code-wiz `src/tooluse/*`(재활용 원본), `src/mcp/`(krh-mcp 서버), `src/history-db.ts`(파사드)

---

## 1. 요약

작은 온디바이스 LLM(Gemma 4 E2B)에게 **범용 메타도구**를 쥐여 주면 도메인 전용이 아니라 **범용 에이전트**로 동작한다는 가설을 검증하는 실험 하네스다. 메타도구는 둘:

- **`call_mcp(server, tool, args)`** — 임의 MCP 서버의 도구를 호출 (1단계)
- **`run_cli(command)`** — 임의 CLI 명령을 실행 (1.5단계, 보안 gate)

이 둘만 있으면 소형 LLM이 재래핑 없이 어떤 MCP·CLI든 부린다. **첫 검증 도메인은 kr-history** — 우리 `krh-mcp` 서버가 이미 존재하므로 `call_mcp`가 그대로 소비한다(도구 재래핑 0). 사실상 **"임의 MCP 서버를 아무 로컬 LLM에 물리는 범용 브릿지"**(로컬 미니 에이전트)이며, 실전 이식을 전제로 **범용 코어를 kr-history 비종속**으로 설계한다.

라이브러리 코어(`src/`)는 수정하지 않는다. 산출물은 `examples/agent-lab/`.

## 2. 배경·동기·가설

- **동기**: 관리형 텍스트 LLM 통합은 이미 충분히 경험했다. 새 가치는 (a) 경량 온디바이스 모델을 (b) **범용 도구 오케스트레이션**으로 에이전트화하는 데 있다. 이 아키텍처는 실전 이식(면접처 즉시 활용)을 전제로 한다.
- **가설(H1)**: 2B급 온디바이스 모델도 `tools/list`로 발견한 도구 스키마를 주입받으면, **범용 메타도구(call_mcp)** 만으로 도메인 지식(kr-history)에 접지된 검증가능한 답을 낸다.
- **핵심 리스크(R1)**: 범용 메타도구는 추상이 한 겹 높다 — 소형 E2B가 `call_mcp`의 `server`·`tool`·`args`(중첩 스키마)를 정확히 구성해야 한다. 이 난이도 자체가 H1의 관문이다. 1단계가 이를 싸게 검증한다.

## 3. 목표 · 비목표

### 목표 (1단계)
- `call_mcp` 메타도구 + `McpBridge`로 소형 E2B가 **krh-mcp 도구를 자율 호출 → 원문 근거로 답변**함을 실증한다.
- 범용 코어(McpBridge·orchestrator·OllamaCaller)를 **kr-history 비종속**으로 구현해 추후 독립 패키지 추출이 가능하게 한다.
- before/after(도구 미사용 vs 사용)를 정성·정량으로 기록한다.

### 비목표 (YAGNI — 후속 분리)
- `run_cli` 및 그 보안 gate → **1.5단계**.
- 멀티모달(이미지) 접지 → **2단계**.
- 브라우저 in-browser 번들(transformers.js+WebGPU) → **3단계**.
- 다중 MCP 서버 동시 오케스트레이션(1단계는 krh-mcp 단일 대상, 스키마만 범용), 세션 영속화, 인증·과금.

## 4. 범위 · 단계 로드맵

| 단계 | 내용 | 게이트 |
|------|------|--------|
| **1단계 (본 스펙 집중)** | Ollama `gemma4:e2b` + 재활용 orchestrator + **`call_mcp` 메타도구 + McpBridge**, 대상 = krh-mcp. 텍스트 tool calling + 근거접지 검증 | §9 성공 기준 |
| 1.5단계 | **`run_cli` 메타도구** + 보안 gate(allowlist) → 완전 범용(krh CLI·파일·git) | 1단계 통과 시 |
| 2단계 | 멀티모달 접지 — 고지도·한자 이미지 판독 → 코퍼스 교정 | 1.5 검증 후 |
| 3단계 | 브라우저 in-browser 번들 + before/after 데모 웹앱 | 별도 스펙 |

**착수 0스텝(모델 가용성 검증)**: 계획 착수 1차로 `ollama pull gemma4:e2b` 태그와 HF 카드(`google/gemma-4-E2B-it`) 실재를 확인한다. (2026-07-17 확인: Ollama `gemma4:e2b`·`gemma4:e2b-it-q4_K_M`, HF `google/gemma-4-E2B-it` 존재 — Gemma 3n E2B와 별개 계열.)

## 5. 아키텍처

### 5.1 재활용 vs 신규 경계

코드위즈 `orchestrator.ts`는 `ModelCaller`로 **의존성 역전(DIP)** 되어 있어 백엔드 무관하게 재활용한다. 신규는 넷:

- **신규 ①** `OllamaModelCaller` = `ModelCaller` 구현 (§6.1)
- **신규 ②** `McpBridge` = MCP SDK 클라이언트 브릿지 — connect·listTools·callTool·close (§6.2)
- **신규 ③** `call_mcp` 메타 `ToolSpec` — McpBridge를 orchestrator 도구 계약으로 노출 (§6.3)
- **신규 ④** `GroundingChecker` = 도메인 접지 어댑터 — 코드위즈 URL exact-match(orchestrator.ts line 27–34, 230–239)를 **passage id/surface 접지**로 치환 (§6.5)

```
┌─ 재활용 (code-wiz/src/tooluse에서 이식) ─────────────┐
│ orchestrator.ts   멀티라운드 루프 (callModel ↔ tool)   │
│ registry.ts       ToolSpec · ToolContext · BudgetTracker · gate│
│ types.ts          ChatMessage·ToolCall·ModelTurn (OpenAI 호환)│
│ sanitizeToolLeak  내부 도구 leak strip                 │
│ (환각검출 골격 재활용, URL→근거접지로 치환 = 신규④)     │
└───────────────┬─────────────────────────────────────┘
                │ ModelCaller (OpenAI 호환)   ← 🆕①
                ▼
         OllamaModelCaller  ── POST localhost:11434/v1/chat/completions
                │ tool_calls: call_mcp(server, tool, args)
                ▼
   call_mcp ToolSpec  ← 🆕③   ──▶  McpBridge  ← 🆕②
                                      │ MCP SDK Client + StdioClientTransport
                                      ▼
                                 krh-mcp 서버 (기존, node dist/mcp/server.js)
                                 search_han·cluster·lookup_place … (재활용)
                │ 결과 JSON → ctx.provided {passageId, hanSurface}
                ▼
         GroundingChecker  ← 🆕④  (도메인 접지 어댑터, §6.5)
```

**범용 코어 격리(실전 원칙)**: `McpBridge`·`OllamaModelCaller`·orchestrator·`call_mcp`는 **kr-history를 전혀 모른다**(범용). kr-history 인지는 **GroundingChecker(접지 어댑터)와 부팅 설정(어느 MCP를 붙이나)** 에만 있다. → 코어를 추후 독립 패키지로 추출 가능.

### 5.2 도구 발견 — tools/list 미리 주입

부팅 시 `McpBridge`가 대상 서버(krh-mcp)에 `tools/list`를 호출해 도구 스키마(name·description·inputSchema)를 받는다. 이 목록을 **`call_mcp` 도구 설명 + 페르소나에 인라인 주입**해, 소형 LLM이 유효한 `tool`명과 `args` 스키마를 알고 호출하게 한다(추론 단계 절감). `call_mcp`의 `tool`은 `enum`(발견된 도구명)으로 제약한다.

### 5.3 데이터 흐름 (예: "낙랑은 평양이었나?")
1. 페르소나(system, 도구목록 주입) + 질의(user) → orchestrator 루프.
2. `OllamaModelCaller`가 E2B에 messages + [`call_mcp`] schema 전달.
3. E2B가 `tool_calls: call_mcp(server:"krh", tool:"search_han", args:{term:"樂浪"})` 등 반환.
4. `call_mcp` handler가 `McpBridge.callTool`로 krh-mcp 호출 → 결과 JSON을 `role:tool`로 누적. **주입된 접지 어댑터(`extractEvidence`, §6.3)를 통해** 근거를 `ctx.provided`에 push(코어는 도메인 무지).
5. E2B가 도구 결과로 최종 답변(원문 `[id]` 인용).
6. orchestrator가 근거접지 검증(§6.5)·leak strip 후 `finalText` 반환.

## 6. 컴포넌트 상세

### 6.1 `OllamaModelCaller` (신규 ①, 얇음)
- `ModelCaller = (messages, tools) => Promise<ModelTurn>`.
- `POST http://localhost:11434/v1/chat/completions`(OpenAI 호환), body: `messages`·`tools`·`tool_choice:'auto'`·`model`. 응답 `choices[0].message` → `ModelTurn`(content·toolCalls·usage). base URL·모델명은 설정 주입(DIP).

### 6.2 `McpBridge` (신규 ②, 범용 코어 — kr-history 무지)
- `@modelcontextprotocol/sdk`의 `Client` + `StdioClientTransport`로 대상 MCP 서버를 자식 프로세스로 spawn·연결.
- API: `connect()`·`listTools(): ToolInfo[]`·`callTool(name, args): unknown`·`close()`.
- 실전 견고성: 연결 타임아웃, `callTool` 에러를 `{error}`로 정규화(orchestrator 계약), 프로세스 종료 시 정리. 다중 서버 대비 `Map<serverId, Client>` 구조(1단계는 krh 하나 등록).
- **1단계 대상 = krh-mcp, 2프로파일 검증(#1)**: 개발본과 배포판을 둘 다 붙여 검증한다.
  - **dev**: `node dist/mcp/server.js`(빌드 선행; `src/mcp/server.ts`는 shebang·`StdioServerTransport` 확인됨) — 개발 소스 그대로 관찰.
  - **product**: `npx -y -p kr-history-bm25 krh-mcp`(Windows `cmd /d /s /c` 래핑 = Claude·Codex 등록 동일) — 배포판 안정성 + 채팅 드롭인 UX 검증.
  - `KRH_DB` 미지정 시 동봉 코퍼스를 자동 오픈하므로 e2e 기동이 현실적. 프로파일 선택(`AGENT_LAB_MCP=dev|product`)·실행 경로는 `config.ts`·README에 고정한다.

### 6.3 `call_mcp` 메타 `ToolSpec` (신규 ③, 범용 코어)
- **팩토리로 생성(도메인 격리의 lynchpin)** — `makeCallMcpTool(bridge: McpBridge, extractEvidence?: (toolName: string, result: unknown) => Evidence[]): ToolSpec`. 도메인 결합을 **콜백 주입(DIP)** 으로 격리 → `call_mcp`는 kr-history 타입을 import하지 않는다. orchestrator는 `spec.handler(args, ctx)`만 호출하므로(코드위즈 orchestrator.ts line 195), 어댑터는 이 팩토리 인자로만 들어온다.
- `name:'call_mcp'`, `parameters`: `{ server:enum, tool:enum(발견목록), args:object }`.
- `handler(args, ctx)` 순서:
  1. `gate`: 등록 서버·발견 도구만 허용(미등록 거부).
  2. **args 런타임 검증** — 발견된 도구 `inputSchema`로 `args`를 검증(zod 등). 미충족 = 구성 실패로 계수 + `{error}` 반환(§8-#1 측정을 결정적으로). `args:object`는 함수 스키마로 dependent 검증이 불가하므로 이 사후 검증이 필수.
  3. `bridge.callTool(tool, args)` 실행.
  4. `extractEvidence`가 주입돼 있으면 `extractEvidence(tool, result)`로 근거를 뽑아 `ctx.provided`에 push(도메인 격리). 미주입이면 raw 결과만 반환. **어댑터 예외 방어** — `extractEvidence`가 던지는 예외(파싱 실패 등)는 삼켜 raw 결과를 유지한다(어댑터 버그가 도구 호출을 실패로 오염시키지 않게 = 측정 무결성 보호).
- 배선: 부팅(run.ts/config)에서 `makeCallMcpTool(bridge, krHistoryExtractEvidence)`로 조립 — **도메인 인지는 이 배선 지점에만** 존재.

### 6.4 재활용 이식 모듈
- `orchestrator.ts`·`registry.ts`·`types.ts`·`sanitizeToolLeak.ts`를 `examples/agent-lab/src/orchestrator/`로 이식. code-wiz 고유 의존(`SourceItem`·`WorkersAiClient`·CRDB 도구) 제거/치환.
- orchestrator의 URL 환각검출 블록(`URL_RE`·`extractUrls`·`offeredUrls/citedUrls/hallucinatedUrls`)은 **제거**하고 §6.5 검증기 호출로 대체. `ToolUseMetrics` URL 필드는 접지 지표로 치환. 이식 헤더에 출처(code-wiz cw-owt9)·이식일 명시.

### 6.5 `GroundingChecker` + kr-history 접지 어댑터 (신규 ④ — 실험 측정 핵심, 도메인 격리)
- **offered(근거 집합)**: kr-history 접지 어댑터 `krHistoryExtractEvidence`(§6.3에 `extractEvidence` 콜백으로 주입)가 `call_mcp` 결과(krh-mcp 도구 JSON)를 파싱해 `Evidence = { passageId, hanSurface }`로 추출 → call_mcp handler가 `ctx.provided`에 push. (도구별: `search_han/search_ko/with_variants/search_by_reading`→`passageId`+`textHan`, `lookup_place`→`passageId`, `cluster/place_clusters`→`surface`.)
- **cited 추출 — 구조적 인용 우선**: 페르소나가 답변에서 근거를 **명시적 `[id]` 토큰**으로 인용하도록 강제. `finalText`에서 `[id]` 추출 → offered id와 **exact match** → 미접지 id = 환각 후보(자동 지표).
- **보조 — surface 접지(정성)**: 답변의 한자 지명이 offered `hanSurface`에 포함되는지 점검(fuzzy → 자동 차단 아닌 정성 라벨).
- `GroundingChecker`(순수 함수: finalText+offered → 지표)는 **범용**, 접지 어댑터(krh 결과 파싱)만 도메인 인지. → 다른 도메인은 어댑터만 교체.

### 6.6 페르소나·프롬프트 (도메인)
- `trust-principle`·`source/context.md` 정합: 근거 없이 단정 금지, 도구 결과로만, 원문 `[id]` 인용, 확정 표현 회피. 통설 오프레이밍 방지(`discovery-*` 사례 정신).
- `call_mcp` 사용법 + 발견된 krh 도구 목록(§5.2 주입) + `[id]` 인용 규칙을 페르소나에 포함.

## 7. 디렉토리 구조

```
examples/agent-lab/
  README.md               # 실행법(ollama pull gemma4:e2b, MCP dev=빌드/product=npx 2모드), 실험 목적
  package.json            # 워크스페이스 예시 (@modelcontextprotocol/sdk·ajv 의존; kr-history-bm25 런타임 의존 없음 — 어댑터 무import)
  tsconfig.json
  src/
    orchestrator/         # 코드위즈 이식(재활용): orchestrator·registry·types·sanitize-tool-leak
    ollama-caller.ts      # 신규① OllamaModelCaller
    mcp-bridge.ts         # 신규② McpBridge (범용 코어, kr-history 무지)
    call-mcp-tool.ts      # 신규③ call_mcp ToolSpec (범용 코어)
    grounding.ts          # 신규④ GroundingChecker (범용) + Evidence 타입
    kr-history-adapter.ts # krh-mcp 결과 → Evidence 접지 어댑터 (도메인 격리)
    persona.ts            # 페르소나 프롬프트 (도메인)
    config.ts             # 부팅 설정 — 어느 MCP를 붙이나, 모델명, base URL
    run.ts                # CLI 진입 — 질의 1건 실행, before/after 출력
  eval/
    queries.json          # 대표 질의셋 (낙랑·遼水·압록 — sg/sy 범위)
    report.ts             # 성공 기준 측정·기록
  tests/                  # vitest — 단위 + e2e(실 Ollama + krh-mcp)
```

## 8. 1단계 성공 기준

1. **메타도구 정확 구성(핵심)**: E2B가 `call_mcp(server, tool, args)`를 유효하게 구성한다 — `tool`이 발견 목록에 있고 `args`가 해당 도구 스키마를 만족(구성 실패율 목표 < 15%).
2. **도구 자율 호출**: 대표 질의에서 적절한 krh 도구를 스스로 선택·호출한다.
3. **근거 기반 답변**: 도구 결과로 답하고 원문 `[id]`를 인용한다.
4. **근거 접지(핵심)**: ① 자동 — 인용 `[id]`가 offered id에 존재(미접지 id율 목표 0) · ② 정성 — 지명·수치 주장이 offered `hanSurface`/passage에 등장. (§6.5)
5. **대표 질의셋 통과**: 낙랑·遼水·압록 등 `discovery-*` 사례에서 통설 단정 없이 공기 지명군을 근거로 제시.
6. **after 중심 + 대표 before 대조 기록(#5)**: after의 정량 지표(메타도구 구성 성공률·도구호출 성공률·`[id]` 인용률·미접지 id율)를 문서화하고, 도구 미사용 대비 개선은 **대표 질의 1건 before** 정성 예시로 대조.

## 9. 실험 설계 (before/after)

- **질의셋**: `eval/queries.json` — discovery 메모리 실측 시드(낙랑 공기군, 遼水/遼河 용법차, 鴨綠 지명화석) + 일반 사료 질의.
  - ※ **코퍼스 커버리지 전제**: `search_ko`·`search_hybrid`는 번역 완료 코퍼스(sg/sy = 삼국사기·삼국유사)에서만 동작. 시드는 sg/sy 범위 내로 선정해 미커버리지를 도구선택 실패로 오인하지 않는다. `search_han`은 전체 한자 코퍼스에서 동작.
- **A조건(before, #5)**: 도구 없이 E2B 단독 답변 — **대표 질의 1건만 참조 기록**(전 질의 반복 없음). 절약 추론량은 B조건 반복 trial·연속 도구호출에 재배분.
- **B조건(after)**: 전 질의를 agent-lab(call_mcp+krh-mcp)으로 — 본 평가 축.
- **측정**(§6.5·§8): 메타도구 구성 성공률, 도구호출 성공률, `[id]` 인용률, 미접지 id율(자동 환각 지표), surface 접지 정성 라벨. `eval/report.ts`가 표로 산출.

## 10. 테스트 · 품질 게이트

- **TDD**: 각 신규 모듈(ollama-caller·mcp-bridge·call-mcp-tool·grounding·kr-history-adapter) 단위 테스트 선작성. `McpBridge`는 mock transport/stub 서버로, `ModelCaller`는 mock 응답으로 orchestrator 배선 검증. `GroundingChecker`는 순수 함수 케이스.
- **e2e**: 실제 Ollama(`gemma4:e2b`) + 실제 krh-mcp(stdio) 기동 후 대표 질의 1~2건으로 call_mcp·근거접지 계약 검증. (Ollama/krh-mcp 미가용 시 skip 태깅.)
- **게이트**: 루트 `npm run validate`(lint·format:check·tsc·vitest) 통과. **경계 확정** — agent-lab의 lint·typecheck·단위 테스트는 루트 게이트 포함, **e2e만 환경 미가용 시 skip 태깅**으로 런타임 격리(§11 R5).

## 11. 리스크 · 완화

| 리스크 | 완화 |
|--------|------|
| R1: 소형 E2B가 `call_mcp` 중첩 스키마 부정확 구성(핵심 관문) | tools/list 스키마 미리 주입(§5.2), `tool` enum 제약, few-shot 예시, 도구 수 제한. 실패 시 프롬프트 하드닝 반복, 그래도 안 되면 가설 반증으로 정직 기록. |
| R2: MCP 클라이언트 lifecycle/에러 | McpBridge에 타임아웃·에러 정규화·프로세스 정리 내장(§6.2). e2e로 실 계약 검증. |
| R3: `run_cli` 임의 실행 보안 | 1.5단계로 분리. allowlist gate(registry gate 활용)·작업 디렉토리 제한 선설계. |
| R4: 이식 시 code-wiz 의존 누수 | `SourceItem`·`WorkersAiClient` 치환 체크리스트로 관리. |
| R5: 예시 패키지가 루트 게이트 오염 | 워크스페이스 경계·tsconfig 분리, e2e만 런타임 격리(§10). |
| R6: 범용 코어에 kr-history 결합 누수 | 코어(bridge·caller·orchestrator·call_mcp)는 도메인 타입 import 금지. 접지·페르소나·설정만 도메인 인지(§5.1). |

## 12. 후속 (별도 스펙)
- **1.5단계**: `run_cli` 메타도구 + 보안 gate → 완전 범용(krh CLI·파일·git).
- **2단계**: 멀티모달 이미지 접지.
- **3단계**: 브라우저 in-browser 번들, before/after 데모 웹앱, 배포·전파.
- **추출·제품화**: 범용 코어(bridge+caller+orchestrator+call_mcp)를 독립 패키지로 분리(실전 이식). 상업화 시 **차별점은 범용 브릿지 자체가 아니라 근거접지 가드레일(trust-principle) + 도메인 지식팩(kr-history 등) 번들** — 순수 범용 로컬 에이전트는 경쟁 밀집(Ollama tool calling·LM Studio·기존 프레임워크). "환각 없는 온디바이스 도메인 에이전트"가 판매 포지션. (검증=1단계 H1 이후.)

## 13. 참조
- Gemma 4 E2B: [HF 카드](https://huggingface.co/google/gemma-4-E2B-it) · [Ollama gemma4:e2b](https://ollama.com/library/gemma4:e2b) · [Function calling](https://ai.google.dev/gemma/docs/capabilities/text/function-calling-gemma4)
- MCP: `@modelcontextprotocol/sdk`(Client·StdioClientTransport), 기존 krh-mcp 서버 `src/mcp/`
- 재활용 원본: code-wiz `src/tooluse/{orchestrator,registry,types,sanitizeToolLeak}.ts`
- 라이브러리 표면: `src/history-db.ts`(파사드), `src/mcp/tools.ts`(도구 계약)
