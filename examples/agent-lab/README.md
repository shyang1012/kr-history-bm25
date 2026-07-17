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

Task 0(워크스페이스 스캐폴딩) 완료. `src/`·`eval/`·`tests/` 실 구현은 Task 1+에서 이어진다.
