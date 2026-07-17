# krh-agent-lab (범용 call_mcp 하네스) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 작은 온디바이스 LLM(Gemma 4 E2B)이 범용 메타도구 `call_mcp`만으로 기존 krh-mcp 서버를 부려 원문 근거로 답하는지 검증하는 실험 하네스를 `examples/agent-lab/`에 구축한다.

**Architecture:** 코드위즈 tool-use 오케스트레이터(멀티라운드 루프·registry·leak strip)를 이식하고, 신규로 ① `OllamaModelCaller`(ModelCaller) ② `McpBridge`(MCP SDK 클라이언트) ③ `call_mcp` ToolSpec(팩토리+콜백 주입) ④ `GroundingChecker`+kr-history 접지 어댑터를 얹는다. 범용 코어는 kr-history 타입을 import하지 않으며(R6), 도메인 인지는 배선·어댑터·페르소나에만 격리한다.

**Tech Stack:** TypeScript(strict, ESM), Node ≥20, `@libsql/client`(라이브러리 경유), `@modelcontextprotocol/sdk`(Client/StdioClientTransport), `ajv`(args 런타임 검증), vitest, Ollama(`gemma4:e2b`).

**Spec:** `docs/superpowers/specs/2026-07-17-krh-agent-lab-design.md`

---

## File Structure

| 파일 | 책임 | 도메인 인지 |
|------|------|------------|
| `examples/agent-lab/package.json`·`tsconfig.json` | 워크스페이스 예시 설정 | — |
| `src/orchestrator/{types,registry,sanitize-tool-leak,orchestrator}.ts` | 이식(재활용) 오케스트레이션 코어 | ✗ 범용 |
| `src/ollama-caller.ts` | 신규① `ModelCaller` = Ollama OpenAI 호환 어댑터 | ✗ 범용 |
| `src/mcp-bridge.ts` | 신규② MCP SDK 클라이언트 브릿지 | ✗ 범용 |
| `src/call-mcp-tool.ts` | 신규③ `makeCallMcpTool` 팩토리(콜백 주입) | ✗ 범용 |
| `src/grounding.ts` | 신규④ `Evidence`·`GroundingChecker`(순수 함수) | ✗ 범용 |
| `src/kr-history-adapter.ts` | krh-mcp 결과 → `Evidence` 추출 콜백 | ✓ 도메인 |
| `src/persona.ts`·`config.ts` | 페르소나·부팅 배선 | ✓ 도메인 |
| `src/run.ts` | CLI 진입(before/after) | ✓ 도메인 |
| `eval/{queries.json,report.ts}` | 질의셋·측정 | ✓ 도메인 |

**커밋 규율:** 각 Task 끝에서 커밋. 소스 헤더 블록(`@Project/@File/@Description/@Author: shyang`) 유지. 커밋 메시지 한국어 conventional.

---

## Task 0: 워크스페이스 스캐폴딩

**착수 절차(bd):** 구현 시작 시 `bd show krh-izc`로 맥락 확인 후 `bd update krh-izc --claim`으로 원자적 클레임. 이하 체크박스(`- [ ]`)는 **계획 명세용 마커**이며, 실제 진행 상태는 bd에 기록한다(AGENTS.md 규율 — TodoWrite·markdown TODO 금지).

**Files:**
- Create: `examples/agent-lab/package.json`, `examples/agent-lab/tsconfig.json`, `examples/agent-lab/README.md`, `examples/agent-lab/.eslintrc.cjs`(#4 로컬 lint config)
- Modify: 루트 `package.json`(workspaces 신설 `["examples/*"]` + `validate` 끝에 예제 게이트 집계), 루트 `tsconfig`(참조 또는 include 확인)

- [ ] **Step 1: 루트 workspaces 신설 (F-03)**

확인됨(2026-07-17): 루트 `workspaces`는 **undefined** — 신설 필요. 루트 `package.json`에 `"workspaces": ["examples/*"]` 추가(이게 있어야 루트 `validate`가 `npm run -w @kr-history/agent-lab …`로 예제 게이트를 집계할 수 있다 = Step 5·#4). ※ `kr-history-bm25` workspace 의존은 두지 않으므로(#1, Step 2) 의존 해석 목적은 아니다. 추가 후 `npm install`로 lockfile 갱신.

- [ ] **Step 2: agent-lab package.json 작성**

```jsonc
{
  "name": "@kr-history/agent-lab",
  "private": true,
  "type": "module",
  "scripts": {
    "lint": "eslint src tests eval --ext .ts",
    "format:check": "prettier --check \"{src,tests,eval}/**/*.{ts,json}\"",
    "typecheck": "tsc --noEmit -p tsconfig.json",
    "test": "vitest run",
    "validate": "npm run lint && npm run format:check && npm run typecheck && npm run test",
    "agent": "tsx src/run.ts"
  },
  "dependencies": {
    "@modelcontextprotocol/sdk": "^1.29.0",
    "ajv": "^8"
  },
  "devDependencies": { "tsx": "*", "vitest": "*", "typescript": "*", "eslint": "*", "prettier": "*" }
}
```
**(F-04)** `@modelcontextprotocol/sdk`는 루트와 동일 `^1.29.0`으로 고정(`"*"` 금지 — 재현성). ajv는 루트에 이미 설치돼 있으나 예제 dependency로 명시. tsx/vitest/typescript 버전은 루트 devDependencies와 정렬.
**(#1 workspace 의존 제거)** `"kr-history-bm25": "workspace:*"` 의존은 **두지 않는다** — 접지 어댑터(Task 6)는 kr-history 타입을 import하지 않고 krh-mcp 결과 JSON을 인라인 타입으로 파싱하므로 runtime 의존이 불필요하다. (착수 시 어댑터가 실제로 `SearchHit` 등 타입 참조를 원하면 그때 `import type`용 devDependency로만 되살린다.) MCP 서버는 dev 프로파일=로컬 빌드 산출, product 프로파일=npx 배포판으로 붙이므로(Task 7) 패키지 의존과 무관.
**(#4 자기완결 게이트)** agent-lab은 lint·format:check·typecheck·test 4종 스크립트를 **자체 보유**하고 루트 `validate`가 `npm run -w`로 집계한다(Step 5). 소스(비테스트) 파일은 `no-explicit-any`(루트 규칙 상속)를 지켜야 하므로 `any` 대신 `unknown`+내로잉·정확한 타입을 쓴다(Task 4·5 코드블록 반영).

- [ ] **Step 3: tsconfig.json 작성** — 루트 tsconfig extends, `"include": ["src", "eval", "tests"]`, strict 유지.

- [ ] **Step 4: README.md 골격** — 목적 1문단 + **2모드 실행 전제(#1)**:
  - 공통: `ollama pull gemma4:e2b`.
  - **dev 모드**(`AGENT_LAB_MCP=dev`, 기본): 루트 `npm run build`로 `dist/mcp/server.js` 생성 후 `node`로 붙임 — 개발 소스 그대로 관찰.
  - **product 모드**(`AGENT_LAB_MCP=product`): `npx -y -p kr-history-bm25 krh-mcp` 배포판(현 0.5.0)을 붙임 — 빌드 불필요, Claude·Codex 동일 환경 안정성 검증.
  - 실행법(`AGENT_LAB_MCP=product npm run agent -- "질의"`). **채팅 드롭인 관찰포인트**: 간단 질의를 던졌을 때 배포판 MCP로 근거 응답이 나오는지(제품 UX)를 정성 관찰 항목으로 기록.

- [ ] **Step 5: 루트 게이트에 agent-lab 편입 (F-03·#4)**

루트 `validate = lint && format:check && typecheck && test`는 현재 `format:check` 글롭=`src/**`·`tests/**`(package.json:83), `tsconfig include:["src"]`, vitest `tests/**`만 대상이라 예제가 **lint·prettier·tsc·test 전부 빠진다**(확인됨). **워크스페이스 자기완결 게이트**로 편입한다(예제가 자기 파일 책임 → 루트 글롭·`tsconfig.eslint.json` 수정 불필요):
- agent-lab `package.json`에 lint·format:check·typecheck·test + 이를 묶는 `validate` 스크립트(Step 2에 기재).
- agent-lab **자체 `.eslintrc.cjs`**(루트 extends) — 소스는 `no-explicit-any` 준수, **`overrides: { files:['tests/**/*.ts'], rules:{ '@typescript-eslint/no-explicit-any':'off' } }`** 포함(테스트 `any` 허용, 소스 금지). 루트 override(`files:['tests/**']`)는 예제 하위 경로를 확실히 매칭 못 하므로 예제 로컬 config가 필요.
- 루트 `package.json` `validate` 끝에 `&& npm run -w @kr-history/agent-lab validate` 집계(4종 전부 예제에도 적용).
- **포함 검증(필수)**: agent-lab에 고의 타입오류(또는 `any`) 파일 하나 두고 루트 `npm run validate`가 **실제로 실패**하는지 1회 확인 후 제거 — lint·prettier·tsc 각각 편입됐는지 확인.

Run: `npm install && npm run validate`
Expected: agent-lab의 lint·format:check·typecheck·test 포함해 통과(고의 오류 삽입 시 실패로 편입 증명).

- [ ] **Step 6: 착수 0스텝 — 모델 가용성 확인**

Run: `ollama pull gemma4:e2b` (실패 시 스펙 §4 정정 트리거 — 진행 전 보고)
Expected: 모델 다운로드 성공.

- [ ] **Step 7: Commit** — `git add examples/agent-lab package.json && git commit -m "chore(agent-lab): 워크스페이스 스캐폴딩 + 모델 가용성 확인"`

---

## Task 1: 오케스트레이터 코어 이식 (재활용)

**Files:**
- Create: `examples/agent-lab/src/orchestrator/types.ts`, `registry.ts`, `sanitize-tool-leak.ts`, `orchestrator.ts`
- 원본: `D:\dev\devApps\code-wiz\code-wiz_worker\src\tooluse\{types,registry,sanitizeToolLeak,orchestrator}.ts`
- Test: `examples/agent-lab/tests/orchestrator.test.ts`

**이식 규칙(중요):**
1. 4개 파일 복사 후 헤더를 `@Project: kr-history-bm25 (agent-lab)` / `@Description: code-wiz cw-owt9 이식(2026-07-17)` / `@Author: shyang`로 교체.
2. code-wiz 고유 의존 제거:
   - `types.ts`: `import { SourceItem } from '../schemas/sourceReferences'` 제거. **(F-01: R6 격리)** `OrchestratorResult.providedSources`를 **`unknown[]`(도메인 중립)** 로 확정 — 코어는 `Evidence` 타입을 **영구히 모른다**. `Evidence`는 `grounding.ts`(에이전트 레이어)에만 존재하며, 소비 시점에만 캐스팅한다.
   - `registry.ts`: `SourceItem` import 제거. **`ToolContext.provided: unknown[]`(도메인 중립)** — Evidence import 금지. `ToolUseEnv`의 검색 API 키 필드 제거(불필요).
   - `orchestrator.ts`: **URL 환각검출 블록 전부 제거** — `URL_RE`, `extractUrls()`, `metrics.offeredUrls/citedUrls/hallucinatedUrls` 관련 라인(원본 27–34, 230–239). `ToolUseMetrics`에서 URL 필드 제거(Task 2에서 접지 지표로 대체). **도구명 난독화(aliasOf/realOf)는 `obfuscateToolNames?: boolean`(RunToolUseArgs) 옵션으로 이식하고 agent-lab에선 기본 off.** 이유: 원본 orchestrator(code-wiz `orchestrator.ts:74–93`)는 도구를 `t1,t2…` opaque ID로 바꿔 **모델엔 t1만 노출**하는데, 본 하네스 페르소나·few-shot은 `call_mcp` 실명 호출을 가르친다 → 소형 E2B에 스키마명↔지시 모순(치명). call_mcp는 공개 범용 메타도구라 은닉 이유도 없다. off 시 `functionSchemas`=실명, dispatch 역매핑은 no-op(항등). 기본값을 false로 두어 별도 지시 없이 실명 노출.
3. `sanitize-tool-leak.ts`: code-wiz 의존 없음 — 헤더만 교체.

- [ ] **Step 1: 4개 파일 복사 + 헤더 교체 + 의존 제거** (위 규칙)

- [ ] **Step 2: 실패 테스트 작성** — orchestrator가 도구 없이 최종답을 반환하고, 도구 1회 호출 후 종료하는 배선 검증(mock ModelCaller·mock ToolSpec).

```ts
// tests/orchestrator.test.ts
import { describe, it, expect } from 'vitest';
import { runToolUse } from '../src/orchestrator/orchestrator';
import { BudgetTracker } from '../src/orchestrator/registry';

const ctx = () => ({ env:{}, lang:'kr' as const, cache:new Map(), budget:new BudgetTracker({maxSubrequests:50,maxLatencyMs:60000,maxLoops:5}), provided:[], log:()=>{} });

it('도구 없이 최종답 반환', async () => {
  const callModel = async () => ({ content:'답변', toolCalls:[], usage:{} });
  const r = await runToolUse({ systemPrompt:'s', userPrompt:'u', tools:[], caps:{maxLoops:5}, callModel, ctx: ctx() });
  expect(r.finalText).toBe('답변');
});
```

- [ ] **Step 3: 테스트 실패 확인** — Run: `npm test -w @kr-history/agent-lab -- orchestrator` · Expected: import/타입 에러 또는 FAIL.

- [ ] **Step 4: 이식 조정으로 통과** — 위 의존 제거를 마무리해 컴파일·테스트 통과.

- [ ] **Step 5: 통과 확인** — Run: 동일 · Expected: PASS.

- [ ] **Step 6: Commit** — `git commit -m "feat(agent-lab): 코드위즈 오케스트레이터 이식(URL 환각검출 제거)"`

---

## Task 2: Evidence + GroundingChecker (신규④, 순수 함수)

**Files:**
- Create: `examples/agent-lab/src/grounding.ts`
- Test: `examples/agent-lab/tests/grounding.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
import { describe, it, expect } from 'vitest';
import { checkGrounding } from '../src/grounding';

it('인용 [id]가 offered에 있으면 접지', () => {
  const r = checkGrounding('樂浪은 遼東과 공기 [12].', [{ passageId:12, hanSurface:'樂浪' }]);
  expect(r.ungroundedIds).toEqual([]);
  expect(r.citedIds).toEqual([12]);
});
it('offered에 없는 [id]는 미접지(환각 후보)', () => {
  const r = checkGrounding('근거 [99].', [{ passageId:12, hanSurface:'樂浪' }]);
  expect(r.ungroundedIds).toEqual([99]);
});
it('surface 접지는 정성 라벨', () => {
  const r = checkGrounding('樂浪郡 이야기', [{ passageId:1, hanSurface:'樂浪郡' }]);
  expect(r.surfaceHits).toContain('樂浪郡');
});
```
> **#3 교정(2026-07-17 재판정):** 원안은 `finalText='樂浪 이야기'`·`hanSurface='樂浪郡'`에서 `toContain('樂浪')`을 기대했으나, 구현(Step 3)은 `finalText.includes(hanSurface)` = `'樂浪 이야기'.includes('樂浪郡')`=false → `surfaceHits=[]`로 Red→Green이 성립하지 않는다. **전체 surface `includes` 매칭에 맞춰 테스트를 교정**한다(구현 불변). 부분표기 매칭은 별도 규칙을 도입하지 않는다(YAGNI).

- [ ] **Step 2: 실패 확인** — Run: `npm test -w @kr-history/agent-lab -- grounding` · Expected: FAIL(checkGrounding 미정의).

- [ ] **Step 3: 구현**

```ts
export interface Evidence { passageId?: number; hanSurface: string; }
export interface GroundingReport {
  citedIds: number[]; ungroundedIds: number[]; groundedRate: number; surfaceHits: string[];
}
const ID_RE = /\[(\d+)\]/g;
export function checkGrounding(finalText: string, offered: Evidence[]): GroundingReport {
  const citedIds = [...new Set([...finalText.matchAll(ID_RE)].map((m) => Number(m[1])))];
  const offeredIds = new Set(offered.map((e) => e.passageId).filter((x): x is number => x != null));
  const ungroundedIds = citedIds.filter((id) => !offeredIds.has(id));
  const groundedRate = citedIds.length ? (citedIds.length - ungroundedIds.length) / citedIds.length : 1;
  const surfaces = offered.map((e) => e.hanSurface).filter(Boolean);
  const surfaceHits = surfaces.filter((s) => finalText.includes(s));
  return { citedIds, ungroundedIds, groundedRate, surfaceHits: [...new Set(surfaceHits)] };
}
```

- [ ] **Step 4: 통과 확인** + **Step 5(F-01): 코어는 `unknown[]` 유지 — `Evidence`를 `types.ts`/`registry.ts`에 연결하지 않는다.** `grounding.ts`의 `Evidence`는 에이전트 레이어(call_mcp 어댑터·`checkGrounding` 캐스팅)에서만 쓴다. 재컴파일 통과.

- [ ] **Step 6: Commit** — `git commit -m "feat(agent-lab): GroundingChecker + Evidence(id 인용 접지)"`

---

## Task 3: OllamaModelCaller (신규①)

**Files:** Create `src/ollama-caller.ts` · Test `tests/ollama-caller.test.ts`

- [ ] **Step 1: 실패 테스트(mock fetch)** — `global.fetch`를 stub해 OpenAI 응답을 반환, `ModelTurn`으로 변환되는지. tool_calls의 `function.arguments`→`argumentsJson` 매핑, assistant 재전송 시 `argumentsJson`→`function.arguments` 역매핑을 검증.

```ts
it('OpenAI 응답을 ModelTurn으로 변환', async () => {
  globalThis.fetch = (async () => ({ ok:true, json: async () => ({
    choices:[{message:{content:'', tool_calls:[{id:'c1',function:{name:'call_mcp',arguments:'{"tool":"search_han"}'}}]}}], usage:{}
  })})) as any;
  const caller = makeOllamaCaller({ baseUrl:'http://x', model:'gemma4:e2b' });
  const turn = await caller([{role:'user',content:'q'}], []);
  expect(turn.toolCalls[0]).toMatchObject({ id:'c1', name:'call_mcp', argumentsJson:'{"tool":"search_han"}' });
});
```

- [ ] **Step 2: 실패 확인** · Run: `npm test -w @kr-history/agent-lab -- ollama-caller`

- [ ] **Step 3: 구현** — `makeOllamaCaller(cfg): ModelCaller`. ChatMessage↔OpenAI 메시지 변환(assistant.tool_calls의 `argumentsJson`→`function.arguments`), 응답 파싱(`choices[0].message` → content·toolCalls·usage), `!res.ok` 시 throw. base URL 기본 `http://localhost:11434`.

- [ ] **Step 4: 통과 확인** · **Step 5: Commit** — `git commit -m "feat(agent-lab): OllamaModelCaller(OpenAI 호환 ModelCaller)"`

---

## Task 4: McpBridge (신규②, 범용 코어)

**Files:** Create `src/mcp-bridge.ts` · Test `tests/mcp-bridge.test.ts`

- [ ] **Step 1: 실패 테스트** — MCP SDK 실서버 대신 **인메모리 stub**로 계약 검증이 어려우면, e2e는 Task 10으로 미루고 여기선 **인터페이스·에러 정규화** 단위 테스트에 집중: `callTool` 미등록 서버 → `{error}` 반환, `listTools` 빈 상태 반환. (실 stdio 연결은 Task 10 e2e.)

```ts
it('미등록 서버 callTool은 error 정규화', async () => {
  const b = new McpBridge();
  const r = await b.callTool('nope', 'search_han', {});
  expect(r).toHaveProperty('error');
});
```

- [ ] **Step 2: 실패 확인** · **Step 3: 구현**

```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
export interface McpServerSpec { id:string; command:string; args:string[]; env?:Record<string,string>; }
export interface ToolInfo { name:string; description:string; inputSchema:Record<string,unknown>; }
export class McpBridge {
  private clients = new Map<string, Client>();
  private toolsByServer = new Map<string, ToolInfo[]>();
  async connect(spec: McpServerSpec): Promise<void> {
    const transport = new StdioClientTransport({ command: spec.command, args: spec.args, env: spec.env });
    const client = new Client({ name:'agent-lab', version:'0.1.0' }, { capabilities:{} });
    await client.connect(transport);
    const { tools } = await client.listTools();
    this.clients.set(spec.id, client);
    // #4: any 금지 — listTools() 반환은 SDK가 타입 제공. 필요한 필드만 안전 추출.
    this.toolsByServer.set(spec.id, tools.map((t)=>({ name:t.name, description:t.description??'', inputSchema:(t.inputSchema??{}) as Record<string,unknown> })));
  }
  listTools(serverId?: string): ToolInfo[] {
    if (serverId) return this.toolsByServer.get(serverId) ?? [];
    return [...this.toolsByServer.values()].flat();
  }
  async callTool(serverId: string, name: string, args: Record<string,unknown>): Promise<unknown> {
    const client = this.clients.get(serverId);
    if (!client) return { error:`unknown server: ${serverId}` };
    try {
      const r = await client.callTool({ name, arguments: args });
      // isError 정규화(보완): MCP 도구레벨 오류는 throw 없이 { isError:true, content } 로 온다.
      // 이를 { error } 로 바꿔 call_mcp handler가 bridge-error로 계수하게 한다(측정 무결성).
      if (r && typeof r === 'object' && (r as { isError?: boolean }).isError) {
        return { error: 'tool error', content: (r as { content?: unknown }).content };
      }
      return r;
    }
    catch (e) { return { error: String(e) }; }
  }
  async close(): Promise<void> { for (const c of this.clients.values()) await c.close(); this.clients.clear(); }
}
```
**SDK API 확인 완료(2026-07-17, `@modelcontextprotocol/sdk@1.29.0`)**: `Client`(`client/index.js`)·`StdioClientTransport`(`client/stdio.js`) import 경로 유효, 인스턴스 메서드 `connect`/`listTools`/`callTool`/`close` 존재. `callTool({ name, arguments })` 반환은 성공 시 `{ content:[{type:'text',text}] }`, **도구레벨 오류 시 `{ isError:true, content:[…] }`(throw 아님)** — 위 정규화가 이를 `{error}`로 바꾼다. `listTools()`는 `{ tools:[{name,description,inputSchema}] }`.

- [ ] **Step 4: 통과 확인** · **Step 5: Commit** — `git commit -m "feat(agent-lab): McpBridge(MCP SDK 클라이언트, 에러 정규화)"`

---

## Task 5: call_mcp ToolSpec 팩토리 (신규③)

**Files:** Create `src/call-mcp-tool.ts` · Test `tests/call-mcp-tool.test.ts`

**핵심(스펙 §6.3):** `makeCallMcpTool(bridge, toolInfos, extractEvidence?)` — 팩토리로 콜백 주입(DIP), 도메인 타입 import 금지. handler 순서 = gate → args 런타임 검증(ajv, 발견 inputSchema) → callTool → extractEvidence push(예외 삼킴).

- [ ] **Step 1: 실패 테스트** — mock bridge로: (a) 미발견 tool → `unknown-tool` `{error}`, (b) args 스키마 위반 → `invalid-args` `{error}`, (c) **미허용 server → `invalid-args` `{error}` 이며 `bridge.callTool` 미호출(Q-01 회귀)**, (d) 정상 → extractEvidence가 ctx.provided에 push + `success` emit, (e) extractEvidence throw → raw 유지·push 없음. 각 케이스에서 `onOutcome`이 해당 `CallOutcome`으로 호출되는지도 검증.

```ts
it('args 스키마 위반은 구성실패', async () => {
  const bridge = { callTool: async()=>({ok:1}), listTools:()=>[] } as any;
  const infos = [{ name:'search_han', description:'', inputSchema:{ type:'object', properties:{term:{type:'string'}}, required:['term'] } }];
  const tool = makeCallMcpTool(bridge, infos);
  const ctx:any = { provided:[] };
  const r = await tool.handler({ server:'krh', tool:'search_han', args:{} }, ctx); // term 누락
  expect(r).toHaveProperty('error');
});
it('정상 호출은 extractEvidence로 접지', async () => {
  const bridge = { callTool: async()=>({content:[{type:'text',text:'[]'}]}), listTools:()=>[] } as any;
  const infos = [{ name:'search_han', description:'', inputSchema:{type:'object',properties:{term:{type:'string'}},required:['term']} }];
  const extract = () => [{ passageId:7, hanSurface:'樂浪' }];
  const tool = makeCallMcpTool(bridge, infos, extract);
  const ctx:any = { provided:[] };
  await tool.handler({ server:'krh', tool:'search_han', args:{term:'樂浪'} }, ctx);
  expect(ctx.provided).toEqual([{ passageId:7, hanSurface:'樂浪' }]);
});
```

- [ ] **Step 2: 실패 확인** · **Step 3: 구현**

**F-01(server 주입)·F-02(outcome 계측) 반영.** `extractEvidence`는 `unknown[]` 반환(코어는 Evidence 무지). gate를 제거하고 **모든 분기를 handler에서 계측**(orchestrator는 handler를 항상 실행하므로 unknown-tool/invalid-args/bridge-error/success 전 분류가 집계 가능). Step 1 테스트도 아래 opts 시그니처로 작성.

```ts
import Ajv from 'ajv';
import type { ToolSpec, ToolContext } from './orchestrator/registry';
import type { McpBridge, ToolInfo } from './mcp-bridge';
// F-01: Evidence 타입 import 금지 — 콜백은 unknown[] 반환(도메인은 배선에서 캐스팅)
export type CallOutcome = 'success' | 'unknown-tool' | 'invalid-args' | 'bridge-error';
export interface CallRecord { tool: string; outcome: CallOutcome; }
// #4: any 금지 — call_mcp 인자 형상을 명시(orchestrator가 이 shape로 TArgs 전달).
export interface CallMcpArgs { server: string; tool: string; args: Record<string, unknown>; }
export interface CallMcpOpts {
  serverIds: string[];                                            // F-01: config 주입(하드코딩 금지)
  extractEvidence?: (tool: string, result: unknown) => unknown[];  // 도메인 콜백(코어는 unknown[])
  onOutcome?: (rec: CallRecord) => void;                          // F-02: 계측 sink(run/report가 배선)
}
export function makeCallMcpTool(bridge: McpBridge, toolInfos: ToolInfo[], opts: CallMcpOpts): ToolSpec<CallMcpArgs> {
  const ajv = new Ajv({ allErrors:true, strict:false });
  const validators = new Map(toolInfos.map((t)=>[t.name, ajv.compile(t.inputSchema)]));
  const toolList = toolInfos.map((t)=>`- ${t.name}: ${t.description}`).join('\n');
  return {
    name:'call_mcp',
    description:`MCP 도구를 호출한다. 사용 가능한 도구:\n${toolList}`,
    parameters:{ type:'object', properties:{
      server:{ type:'string', enum: opts.serverIds },              // F-01: 주입된 서버 집합
      tool:{ type:'string', enum: toolInfos.map((t)=>t.name) },
      args:{ type:'object' },
    }, required:['server','tool','args'] },
    // gate 제거(F-02): 모든 분기를 handler에서 계측. orchestrator는 handler를 항상 실행.
    cost:()=>1,
    handler: async (a: CallMcpArgs, ctx: ToolContext): Promise<unknown> => {
      const emit = (outcome: CallOutcome): void => opts.onOutcome?.({ tool: a?.tool, outcome });
      // Q-01: server allow-list 런타임 검증(enum은 LLM 가이드일 뿐 강제 아님 — 미허용 서버가 bridge로 새지 않게)
      if (!opts.serverIds.includes(a?.server)) { emit('invalid-args'); return { error:`unknown server: ${a?.server}` }; }
      const validate = validators.get(a?.tool);
      if (!validate) { emit('unknown-tool'); return { error:`unknown tool: ${a?.tool}` }; }
      if (!validate(a.args)) { emit('invalid-args'); return { error:`invalid args for ${a.tool}: ${ajv.errorsText(validate.errors)}` }; }
      const result: unknown = await bridge.callTool(a.server, a.tool, a.args ?? {});
      if (result && typeof result === 'object' && 'error' in result) { emit('bridge-error'); return result; }
      emit('success');
      if (opts.extractEvidence) {
        try { ctx.provided.push(...opts.extractEvidence(a.tool, result)); } catch { /* 어댑터 예외 삼킴 */ }
      }
      return result;
    },
  };
}
```
> **#4 타입 주의:** `ToolSpec<TArgs=Record<string,unknown>, TResult=unknown>`(code-wiz `registry.ts:129`)의 제네릭을 사용해 `handler:(a:CallMcpArgs, ctx:ToolContext)`로 명시(source `any` 0). 이식된 `registry.ts`의 `ToolContext.provided`는 F-01대로 `unknown[]`이므로 `ctx.provided.push(...unknown[])` 정합. Task 5 Step 1 테스트의 `ctx:any`·`as any`는 테스트 파일이라 eslint override(#4)로 허용.
**계측 계약(F-02)**: `CallOutcome` 4분류가 §8-#1·§9 지표의 분모/분자다 — 구성실패율 = `(unknown-tool + invalid-args) / 총 call_mcp 시도`, 도구호출 성공률 = `success / (success + bridge-error)`. **`bridge-error`에는 (a) McpBridge가 throw를 정규화한 `{error}`와 (b) MCP 도구레벨 `{isError:true}`를 정규화한 `{error}`(Task 4 보완)가 모두 집계된다** — 즉 도구가 실패를 반환한 경우도 성공으로 오계수되지 않는다.

- [ ] **Step 4: 통과 확인** · **Step 5: Commit** — `git commit -m "feat(agent-lab): call_mcp 팩토리(콜백 주입·args 검증·접지 push)"`

---

## Task 6: kr-history 접지 어댑터 (도메인)

**Files:** Create `src/kr-history-adapter.ts` · Test `tests/kr-history-adapter.test.ts`

**주의:** krh-mcp 결과는 `{content:[{type:'text',text: JSON.stringify(...)}]}`. 어댑터가 text를 파싱해 도구별 구조에서 Evidence 추출. **각 도구 실제 반환 구조를 `src/types.ts`(SearchHit·ClusterNeighbor·PlaceOccurrence 등)와 `src/mcp/tools.ts`(with_variants·search_by_reading은 래핑 구조)로 확인 후 매핑.**

- [ ] **Step 1: 실패 테스트** — search_han 결과(SearchHit[]) → `{passageId, hanSurface:textHan}`, cluster 결과(ClusterNeighbor[]) → `{hanSurface:surface}`, 파싱 불가 → `[]`.

```ts
it('search_han 결과를 Evidence로', () => {
  const mcp = { content:[{ type:'text', text: JSON.stringify([{ passageId:5, nodeId:'n', corpusCode:'sg', textHan:'樂浪郡', score:1 }]) }] };
  expect(krHistoryExtractEvidence('search_han', mcp)).toEqual([{ passageId:5, hanSurface:'樂浪郡' }]);
});
it('cluster 결과는 surface만', () => {
  const mcp = { content:[{ type:'text', text: JSON.stringify([{ type:'지명', surface:'遼東', count:58 }]) }] };
  expect(krHistoryExtractEvidence('cluster', mcp)).toEqual([{ hanSurface:'遼東' }]);
});
it('place_clusters는 clusters[].members[].surface 추출', () => {
  const mcp = { content:[{ type:'text', text: JSON.stringify({ clusters:[{ members:[{ surface:'樂浪' }, { surface:'帶方' }] }] }) }] };
  expect(krHistoryExtractEvidence('place_clusters', mcp)).toEqual([{ hanSurface:'樂浪' }, { hanSurface:'帶方' }]);
});
```

- [ ] **Step 2: 실패 확인** · **Step 3: 구현** — `parseMcpText(result)`(`result.content[0].text` → `JSON.parse`, 실패 시 throw) + 도구별 정규화. **반환 구조 확인 완료(2026-07-17)**:
  - `search_han`·`search_ko` → `SearchHit[]` **직접**(배열)
  - `with_variants`·`search_hybrid`·`search_by_reading` → `.hits: SearchHit[]`(래핑) — `json.hits ?? (Array.isArray(json) ? json : [])`로 **통일**해 `{ passageId: h.passageId, hanSurface: h.textHan }` 매핑
  - `lookup_place` → `PlaceOccurrence[]` → `{ passageId: o.passageId, hanSurface: '' }`
  - `cluster` → `ClusterNeighbor[]` → `{ hanSurface: n.surface }`; `place_clusters` → `PlaceClusterResult`(구조 상이, `.clusters[].members[].surface` 확인 후 surface만)
  - 미지원 도구·파싱 실패 → `[]`

- [ ] **Step 4: 통과 확인** · **Step 5: Commit** — `git commit -m "feat(agent-lab): kr-history 접지 어댑터(도구별 Evidence 추출)"`

---

## Task 7: 페르소나 + config (배선)

**Files:** Create `src/persona.ts`, `src/config.ts`

- [ ] **Step 1: persona.ts** — `buildPersona(toolInfos): string`. `trust-principle`·context.md 규약(근거 없이 단정 금지·도구 결과로만·원문 `[id]` 인용·확정 표현 회피·통설 오프레이밍 방지) + call_mcp 사용법 + 발견 도구 목록 주입 + few-shot 1개(질의→call_mcp(search_han)→[id] 인용 답).

- [ ] **Step 2: config.ts** — `AGENT_CONFIG`: ollama `{baseUrl, model:'gemma4:e2b'}`, caps `{maxLoops:6}`, 그리고 **mcp server spec을 2프로파일(#1)** 로:
  - `krhDev`: `{ id:'krh', command:'node', args:[<repo>/dist/mcp/server.js], env:{} }` — 개발본(빌드 선행; 경로는 repo 루트 기준 resolve).
  - `krhProduct`: `{ id:'krh', command:'cmd', args:['/d','/s','/c','npx','-y','-p','kr-history-bm25','krh-mcp'], env:{} }` — 배포판(Windows `cmd` 래핑 = Claude·Codex 등록 동일; 빌드 불필요).
  - 프로파일 선택: `process.env.AGENT_LAB_MCP === 'product' ? krhProduct : krhDev`(기본 dev). run.ts가 선택 spec으로 connect.
  - 재현성: product 실행 시 실행 npm·패키지 버전(현 0.5.0)을 리포트에 기록(로컬 미푸시 변경은 product에 반영 안 됨 — dev 모드가 그 역할).

- [ ] **Step 3: 타입/빌드 확인** — Run: `npx tsc -p examples/agent-lab/tsconfig.json --noEmit` · Expected: 통과.

- [ ] **Step 4: Commit** — `git commit -m "feat(agent-lab): 페르소나(trust-principle) + 부팅 config"`

---

## Task 8: run.ts CLI (before/after 배선)

**Files:** Create `src/run.ts`

- [ ] **Step 1: 구현** — 배선 조립(도메인 인지는 여기·어댑터·페르소나에만 = R6):
  1. `bridge = new McpBridge(); await bridge.connect(AGENT_CONFIG.krh)`.
  2. `toolInfos = bridge.listTools('krh')`.
  3. `const outcomes: CallRecord[] = []; const callMcp = makeCallMcpTool(bridge, toolInfos, { serverIds: ['krh'], extractEvidence: krHistoryExtractEvidence, onOutcome: (r)=>outcomes.push(r) })` **(F-01 serverIds 주입 + F-02 계측 sink 배선)**.
  4. `caller = makeOllamaCaller(AGENT_CONFIG.ollama)`.
  5. **after** = `runToolUse({ systemPrompt: buildPersona(toolInfos), userPrompt: query, tools:[callMcp], caps, callModel: caller, ctx, obfuscateToolNames: false })` → `checkGrounding(finalText, ctx.provided as Evidence[])` **(코어 provided=unknown[]을 도메인 레이어에서 캐스팅, F-01; `obfuscateToolNames:false`로 call_mcp 실명 노출 = #2)**.
  6. **before(#5)** = **대표 질의 1건만** 선택적으로 도구 없이 1턴 기록(전 질의 반복 제거 — `--before` 플래그 또는 대표질의 지정 시에만). 절약한 추론량은 반복 trial·연속 도구호출에 재배분.
  7. after(전 질의) + GroundingReport + `outcomes`(CallOutcome 집계) + (있으면)대표 1건 before를 stdout 출력. `finally { await bridge.close() }`.

- [ ] **Step 2: 수동 스모크(선택, Ollama 필요) — 2모드(#1)**:
  - dev: `npm run build && AGENT_LAB_MCP=dev npm run agent -w @kr-history/agent-lab -- "낙랑은 어디였나"`
  - product: `AGENT_LAB_MCP=product npm run agent -w @kr-history/agent-lab -- "낙랑은 어디였나"`(빌드 불필요)
  - Expected: after(call_mcp 호출·[id] 인용)·접지 리포트 출력, (대표질의라면)before 대조. product는 채팅 드롭인 관찰(간단 질의 응답)도 정성 기록. (실패 시 R1 관찰 기록.)

- [ ] **Step 3: Commit** — `git commit -m "feat(agent-lab): run.ts CLI(before/after + 접지 리포트)"`

---

## Task 9: eval 질의셋 + report

**Files:** Create `eval/queries.json`, `eval/report.ts`

- [ ] **Step 1: queries.json** — discovery 시드 기반(sg/sy 범위): 樂浪 공기·遼水 용법·鴨綠 지명·일반 사료 질의 5~8개. 각 항목 `{ id, query, expectTools?, note }`. **연속 도구호출 사례 1건 포함** — `search_han`으로 지명 passage를 찾고 이어서 `cluster`로 공기 지명군을 뽑는 2단계 호출을 few-shot/`note`에 명시(멀티라운드 루프 검증).

- [ ] **Step 2: report.ts** — 각 질의를 run 파이프라인(`outcomes` sink 포함)으로 실행, §8 지표 집계 → 표(마크다운/콘솔). **after 중심 지표 + 대표 1건 before 대조 참조(#5)**(전 질의 before 반복 제거). **F-02 집계식(CallOutcome 기반)**:
  - 메타도구 구성 실패율 = `(unknown-tool + invalid-args) / 총 call_mcp 시도` (목표 < 15%)
  - 도구호출 성공률 = `success / (success + bridge-error)`
  - `[id]` 인용률 = `checkGrounding.citedIds.length>0` 질의 비율
  - 미접지 id율 = `Σ ungroundedIds / Σ citedIds`
  - surface 접지 = `surfaceHits` 정성 라벨

- [ ] **Step 3: 타입 확인** · **Step 4: Commit** — `git commit -m "feat(agent-lab): eval 질의셋 + 측정 리포트"`

---

## Task 10: e2e (실 Ollama + krh-mcp)

**Files:** Create `tests/e2e.test.ts`

- [ ] **Step 1: e2e 테스트** — 환경 가드: Ollama(`gemma4:e2b`) 미가용 시 `describe.skip`. `AGENT_LAB_MCP` 스위치로 **dev/product 각각 계약검증(#1)**(dev는 빌드 산출 미가용 시 skip, product는 npx 네트워크 필요 시 skip 태깅). 가용 시: 실제 bridge.connect(krh) → (a) **`listTools('krh')`가 정확히 8개 도구명 포함** assert — `search_han`·`search_ko`·`search_hybrid`·`search_by_reading`·`with_variants`·`cluster`·`place_clusters`·`lookup_place` → 대표 질의 1건 run → (b) call_mcp 도구 호출 발생, (c) ctx.provided 비어있지 않음, (d) 접지 리포트 산출을 assert(성능 임계 아닌 계약 검증).

```ts
const OLLAMA = process.env.AGENT_LAB_E2E === '1';
(OLLAMA ? describe : describe.skip)('e2e', () => {
  it('call_mcp로 krh-mcp 호출·접지', async () => { /* connect→run→assert provided.length>0 */ });
});
```

- [ ] **Step 2: 게이트 확인** — Run(루트): `npm run validate` · Expected: lint·format·tsc·vitest 통과(e2e는 skip). CRLF 이슈 시 `npm run format` 선행(ci-format-crlf-gotcha).

- [ ] **Step 3: Commit** — `git commit -m "test(agent-lab): e2e(실 Ollama+krh-mcp, 환경 가드 skip)"`

---

## 완료 기준 (스펙 §8 대응)

- Task 0–10 전 커밋 완료, 루트 `npm run validate` 통과.
- (Ollama 가용 시) `eval/report.ts` 실행으로 §8 지표 표 산출 — **메타도구 구성 성공률·미접지 id율**이 핵심. **after 중심 지표 + 대표 1건 before 대조**(#5). dev·product 2모드(#1) 각각 기록.
- R1 결과(소형 E2B의 call_mcp 구성 능력)를 **성공이든 반증이든 정직하게** README/리포트에 기록 → bd `krh-izc` 갱신.
- 1.5단계(run_cli)·2단계(멀티모달)는 별도 스펙/계획.
