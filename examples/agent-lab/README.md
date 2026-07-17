# agent-lab

작은 온디바이스 LLM(Gemma4 E2B)이 범용 `call_mcp` 메타도구 하나만으로 `krh-mcp`를 부려,
한국사 사료 원문(한자)에 근거해 답할 수 있는지 검증하는 실험 워크스페이스다. 라이브러리
코어(`src/`, 루트)는 건드리지 않고, 산출물은 전부 이 디렉터리 아래에서만 다룬다.

## 공통 전제

```bash
ollama pull gemma4:e2b
```

## MCP 연결 모드

두 가지 모드로 `krh-mcp` 서버에 붙을 수 있다. `AGENT_LAB_MCP` 환경변수로 선택한다.

### dev 모드 (기본, `AGENT_LAB_MCP=dev`)

루트에서 빌드한 `dist/mcp/server.js`를 `node`로 직접 실행해 붙는다. 개발 중인 소스 그대로
관찰할 때 쓴다.

```bash
npm run build          # 루트에서 — dist/mcp/server.js 생성
npm run agent -w @kr-history/agent-lab -- "질의"
```

### product 모드 (`AGENT_LAB_MCP=product`)

npm에 배포된 `kr-history-bm25` 패키지(현재 0.5.0)의 `krh-mcp` 바이너리를 `npx`로 붙인다.
빌드가 필요 없고, Claude·Codex 등 클라이언트 환경 간 동일 조건에서 안정성을 검증할 때 쓴다.

```bash
AGENT_LAB_MCP=product npm run agent -w @kr-history/agent-lab -- "질의"
```

## 관찰 포인트

- **채팅 드롭인 관찰**: 간단한 질의 하나를 product 모드로 던져 근거(원문 인용)가 실제로 붙은
  응답이 나오는지 정성적으로 기록한다. 정량 평가는 `eval/`에서 별도로 다룬다.

## 상태

1단계 하네스 **구현 완료**(Task 0~10) — 범용 `call_mcp` 메타도구 + `McpBridge`(MCP SDK) +
`OllamaModelCaller` + 재활용 orchestrator + `GroundingChecker` + kr-history 접지 어댑터.
루트 `npm run validate` green(단위 39, e2e는 `AGENT_LAB_E2E` 가드로 평소 skip).

### R1 실험 결과 (2026-07-17, `gemma4:e2b` 실구동 — 정직 기록)

핵심 관문 **R1**(소형 2B 온디바이스 모델이 `call_mcp`의 2단 중첩 스키마 `(server, tool, args)`를
자율 구성하는가) = **부분 반증**.

- ✅ **하네스는 완전 작동** — `krh-mcp` 8개 도구 정확 노출, stdio 브릿지 연결, 멀티라운드 루프,
  F-02 계측, 접지 리포트가 end-to-end로 돈다(e2e 계약 통과).
- ⚠️ **도구호출 능력은 있으나 취약** — 강한 명령형 프롬프트엔 `call_mcp` tool_calls를 방출하지만,
  `trust-principle` 페르소나 + 평이한 질문("낙랑은 어디에 있었나")엔 **자율 호출하지 않는다**.
- ❌ **중첩 스키마 오구성** — 호출하더라도 `server` 필드에 도구명을 넣거나(enum `['krh']` 무시),
  arg 키를 틀린다(`query` vs 실제 `search_han`의 `term`) → allow-list / ajv에서 거부.
- 관찰: `gemma4:e2b`는 답을 OpenAI `reasoning` 필드에 담고 `content`를 비워 반환하는 경향이 있다.

**함의**: 2B 온디바이스 모델은 범용 메타도구의 2단 중첩을 안정적으로 자율 구성하지 못한다.
다음 실험 후보 — (a) 프롬프트 하드닝(`server='krh'` 고정 강조·도구별 정확 arg 키 few-shot·명령형),
(b) `reasoning` 필드 fallback 파싱, (c) 상위/4B 모델 대조, (d) 도구별 직접 노출로 중첩 1단 완화
(범용성 트레이드오프). 상세는 bd `krh-agent-lab-r1-finding`.
