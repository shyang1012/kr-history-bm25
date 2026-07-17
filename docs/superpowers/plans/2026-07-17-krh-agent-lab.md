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

**Files:**
- Create: `examples/agent-lab/package.json`, `examples/agent-lab/tsconfig.json`, `examples/agent-lab/README.md`
- Modify: 루트 `package.json`(workspaces에 `examples/agent-lab` 추가 — 이미 workspaces면 배열에 추가, 없으면 신설), 루트 `tsconfig`(참조 또는 include 확인)

- [ ] **Step 1: 루트 workspaces 신설 (F-03)**

확인됨(2026-07-17): 루트 `workspaces`는 **undefined** — 신설 필요. 루트 `package.json`에 `"workspaces": ["examples/*"]` 추가(이게 있어야 `"kr-history-bm25": "workspace:*"` 의존이 해석됨). 추가 후 `npm install`로 lockfile 갱신.

- [ ] **Step 2: agent-lab package.json 작성**

```jsonc
{
  "name": "@kr-history/agent-lab",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "vitest run",
    "agent": "tsx src/run.ts"
  },
  "dependencies": {
    "kr-history-bm25": "workspace:*",
    "@modelcontextprotocol/sdk": "^1.29.0",
    "ajv": "^8"
  },
  "devDependencies": { "tsx": "*", "vitest": "*", "typescript": "*" }
}
```
**(F-04)** `@modelcontextprotocol/sdk`는 루트와 동일 `^1.29.0`으로 고정(`"*"` 금지 — 재현성). ajv는 루트에 이미 설치돼 있으나 예제 dependency로 명시. tsx/vitest/typescript 버전은 루트 devDependencies와 정렬.

- [ ] **Step 3: tsconfig.json 작성** — 루트 tsconfig extends, `"include": ["src", "eval", "tests"]`, strict 유지.

- [ ] **Step 4: README.md 골격** — 목적 1문단 + 실행 전제(`ollama pull gemma4:e2b`, 루트 `npm run build`로 `dist/mcp/server.js` 생성), 실행법(`npm run agent -- "질의"`).

- [ ] **Step 5: 루트 게이트에 agent-lab 편입 (F-03)**

루트 `validate = lint && format:check && typecheck && test`는 현재 `tsconfig include:["src"]`·vitest `tests/**`만 대상이라 예제가 통째로 빠진다(확인됨). 다음을 설정:
- agent-lab `package.json`에 `"typecheck": "tsc --noEmit -p tsconfig.json"` 추가.
- 루트 `package.json` `validate` 끝에 workspace 게이트 집계 추가 — `&& npm run -w @kr-history/agent-lab typecheck && npm run -w @kr-history/agent-lab test`.
- ESLint: 루트 `tsconfig.eslint.json` include(`["src","tests","*.ts"]`)에 `"examples/agent-lab/**/*.ts"` 추가(또는 예제 자체 eslint config).
- **포함 검증(필수)**: agent-lab에 고의 타입오류 파일 하나 두고 루트 `npm run validate`가 **실제로 실패**하는지 1회 확인 후 오류 제거.

Run: `npm install && npm run validate`
Expected: agent-lab 포함해 통과(고의 오류 삽입 시 실패로 편입 증명).

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
   - `orchestrator.ts`: **URL 환각검출 블록 전부 제거** — `URL_RE`, `extractUrls()`, `metrics.offeredUrls/citedUrls/hallucinatedUrls` 관련 라인(원본 27–34, 230–239). `ToolUseMetrics`에서 URL 필드 제거(Task 2에서 접지 지표로 대체). 도구명 난독화(aliasOf/realOf)는 유지(범용 가드).
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
  const r = checkGrounding('樂浪 이야기', [{ passageId:1, hanSurface:'樂浪郡' }]);
  expect(r.surfaceHits).toContain('樂浪');
});
```

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
    this.toolsByServer.set(spec.id, tools.map((t:any)=>({ name:t.name, description:t.description??'', inputSchema:t.inputSchema??{} })));
  }
  listTools(serverId?: string): ToolInfo[] {
    if (serverId) return this.toolsByServer.get(serverId) ?? [];
    return [...this.toolsByServer.values()].flat();
  }
  async callTool(serverId: string, name: string, args: Record<string,unknown>): Promise<unknown> {
    const client = this.clients.get(serverId);
    if (!client) return { error:`unknown server: ${serverId}` };
    try { return await client.callTool({ name, arguments: args }); }
    catch (e) { return { error: String(e) }; }
  }
  async close(): Promise<void> { for (const c of this.clients.values()) await c.close(); this.clients.clear(); }
}
```
**SDK API 확인 완료(2026-07-17, `@modelcontextprotocol/sdk@1.29.0`)**: `Client`(`client/index.js`)·`StdioClientTransport`(`client/stdio.js`) import 경로 유효, 인스턴스 메서드 `connect`/`listTools`/`callTool`/`close` 존재. `callTool({ name, arguments })` 반환은 `{ content:[{type:'text',text}] }`(Task 6 파싱 전제와 일치). `listTools()`는 `{ tools:[{name,description,inputSchema}] }`.

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
import type { ToolSpec } from './orchestrator/registry';
import type { McpBridge, ToolInfo } from './mcp-bridge';
// F-01: Evidence 타입 import 금지 — 콜백은 unknown[] 반환(도메인은 배선에서 캐스팅)
export type CallOutcome = 'success' | 'unknown-tool' | 'invalid-args' | 'bridge-error';
export interface CallRecord { tool: string; outcome: CallOutcome; }
export interface CallMcpOpts {
  serverIds: string[];                                            // F-01: config 주입(하드코딩 금지)
  extractEvidence?: (tool: string, result: unknown) => unknown[];  // 도메인 콜백(코어는 unknown[])
  onOutcome?: (rec: CallRecord) => void;                          // F-02: 계측 sink(run/report가 배선)
}
export function makeCallMcpTool(bridge: McpBridge, toolInfos: ToolInfo[], opts: CallMcpOpts): ToolSpec {
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
    handler: async (a:any, ctx:any) => {
      const emit = (outcome: CallOutcome) => opts.onOutcome?.({ tool: a?.tool, outcome });
      // Q-01: server allow-list 런타임 검증(enum은 LLM 가이드일 뿐 강제 아님 — 미허용 서버가 bridge로 새지 않게)
      if (!opts.serverIds.includes(a?.server)) { emit('invalid-args'); return { error:`unknown server: ${a?.server}` }; }
      const validate = validators.get(a?.tool);
      if (!validate) { emit('unknown-tool'); return { error:`unknown tool: ${a?.tool}` }; }
      if (!validate(a.args)) { emit('invalid-args'); return { error:`invalid args for ${a.tool}: ${ajv.errorsText(validate.errors)}` }; }
      const result: any = await bridge.callTool(a.server, a.tool, a.args ?? {});
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
**계측 계약(F-02)**: `CallOutcome` 4분류가 §8-#1·§9 지표의 분모/분자다 — 구성실패율 = `(unknown-tool + invalid-args) / 총 call_mcp 시도`, 도구호출 성공률 = `success / (success + bridge-error)`.

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

- [ ] **Step 2: config.ts** — `AGENT_CONFIG`: ollama `{baseUrl, model:'gemma4:e2b'}`, mcp server spec `{ id:'krh', command:'node', args:[<repo>/dist/mcp/server.js], env:{} }`(경로는 repo 루트 기준 resolve; 빌드 선행 필요 — README 명시), caps `{maxLoops:6}`.

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
  5. **after** = `runToolUse({ systemPrompt: buildPersona(toolInfos), userPrompt: query, tools:[callMcp], caps, callModel: caller, ctx })` → `checkGrounding(finalText, ctx.provided as Evidence[])` **(코어 provided=unknown[]을 도메인 레이어에서 캐스팅, F-01)**.
  6. **before** = 동일 caller로 도구 없이 1턴 호출(대조).
  7. before/after + GroundingReport + `outcomes`(CallOutcome 집계)를 stdout 출력. `finally { await bridge.close() }`.

- [ ] **Step 2: 수동 스모크(선택, Ollama 필요)** — Run: `npm run build && npm run agent -w @kr-history/agent-lab -- "낙랑은 어디였나"` · Expected: before(도구없음)·after(call_mcp 호출·[id] 인용)·접지 리포트 출력. (실패 시 R1 관찰 기록.)

- [ ] **Step 3: Commit** — `git commit -m "feat(agent-lab): run.ts CLI(before/after + 접지 리포트)"`

---

## Task 9: eval 질의셋 + report

**Files:** Create `eval/queries.json`, `eval/report.ts`

- [ ] **Step 1: queries.json** — discovery 시드 기반(sg/sy 범위): 樂浪 공기·遼水 용법·鴨綠 지명·일반 사료 질의 5~8개. 각 항목 `{ id, query, expectTools?, note }`.

- [ ] **Step 2: report.ts** — 각 질의를 run 파이프라인(`outcomes` sink 포함)으로 실행, §8 지표 집계 → 표(마크다운/콘솔) + before/after 비교 열. **F-02 집계식(CallOutcome 기반)**:
  - 메타도구 구성 실패율 = `(unknown-tool + invalid-args) / 총 call_mcp 시도` (목표 < 15%)
  - 도구호출 성공률 = `success / (success + bridge-error)`
  - `[id]` 인용률 = `checkGrounding.citedIds.length>0` 질의 비율
  - 미접지 id율 = `Σ ungroundedIds / Σ citedIds`
  - surface 접지 = `surfaceHits` 정성 라벨

- [ ] **Step 3: 타입 확인** · **Step 4: Commit** — `git commit -m "feat(agent-lab): eval 질의셋 + 측정 리포트"`

---

## Task 10: e2e (실 Ollama + krh-mcp)

**Files:** Create `tests/e2e.test.ts`

- [ ] **Step 1: e2e 테스트** — 환경 가드: Ollama(`gemma4:e2b`)·krh-mcp 빌드 산출 미가용 시 `describe.skip`. 가용 시: 실제 bridge.connect(krh) → 대표 질의 1건 run → (a) call_mcp 도구 호출 발생, (b) ctx.provided 비어있지 않음, (c) 접지 리포트 산출을 assert(성능 임계 아닌 계약 검증).

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
- (Ollama 가용 시) `eval/report.ts` 실행으로 §8 지표 표 산출 — **메타도구 구성 성공률·미접지 id율**이 핵심. before/after 대비 기록.
- R1 결과(소형 E2B의 call_mcp 구성 능력)를 **성공이든 반증이든 정직하게** README/리포트에 기록 → bd `krh-izc` 갱신.
- 1.5단계(run_cli)·2단계(멀티모달)는 별도 스펙/계획.
