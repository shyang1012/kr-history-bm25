/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/run.ts
 * @Description: run.ts — before/after 배선 조립 + 접지 리포트 출력. 도메인 배선 최종 조립(R6 — 도메인
 *   인지는 run·어댑터·persona·config에만 둔다). `runQuery()`는 McpBridge 연결 → call_mcp 배선 →
 *   Ollama caller → orchestrator 실행 → checkGrounding 순으로 조립하는 테스트 가능한 함수이며(Task 10
 *   e2e가 직접 호출), 파일 하단 CLI 래퍼가 argv를 파싱해 얇게 감싼다. 진단 로그는 console.error, stdout은
 *   결과만 출력한다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { pathToFileURL } from 'node:url';
import { McpBridge } from './mcp-bridge';
import type { McpServerSpec } from './mcp-bridge';
import { makeCallMcpTool } from './call-mcp-tool';
import type { CallRecord } from './call-mcp-tool';
import { makeOllamaCaller } from './ollama-caller';
import { runToolUse } from './orchestrator/orchestrator';
import { BudgetTracker } from './orchestrator/registry';
import type { ToolContext, ToolSpec } from './orchestrator/registry';
import { checkGrounding } from './grounding';
import type { Evidence, GroundingReport } from './grounding';
import { krHistoryExtractEvidence } from './kr-history-adapter';
import { buildPersona } from './persona';
import { AGENT_CONFIG } from './config';

/** runQuery 옵션 — before(#5) 실행 여부·MCP 서버 스펙(테스트 시 오버라이드) */
export interface RunQueryOpts {
  /** true면 도구 없는 1턴(before) 답변도 함께 실행한다. 기본은 실행 안 함(전 질의 반복 제거). */
  before?: boolean;
  mcpSpec?: McpServerSpec;
}

/** runQuery 반환 — after/grounding/outcomes/provided + 선택적 before. */
export interface AgentRunResult {
  after: { finalText: string; metrics: unknown };
  grounding: GroundingReport;
  outcomes: CallRecord[];
  provided: Evidence[];
  /** #5: opts.before===true일 때만 채워지는 대표 1건 비교용 답변. */
  before?: string;
}

/**
 * krh MCP 서버에 연결해 call_mcp 도구를 배선하고, Ollama 모델로 tool-use 오케스트레이터를 1회
 * 실행한 뒤 접지 리포트를 계산한다. bridge는 finally에서 항상 close한다.
 *
 * @param query 사용자 질의
 * @param opts before(#5) 실행 여부·MCP 서버 스펙 오버라이드(테스트용)
 * @returns after 답변·접지 리포트·call_mcp 계측·제공 근거·(선택)before 답변
 */
export async function runQuery(query: string, opts?: RunQueryOpts): Promise<AgentRunResult> {
  const spec = opts?.mcpSpec ?? AGENT_CONFIG.krh;
  const bridge = new McpBridge();
  await bridge.connect(spec);
  try {
    const toolInfos = bridge.listTools('krh');
    const outcomes: CallRecord[] = [];
    const callMcp = makeCallMcpTool(bridge, toolInfos, {
      serverIds: ['krh'],
      extractEvidence: krHistoryExtractEvidence,
      onOutcome: (r) => outcomes.push(r),
    });
    const caller = makeOllamaCaller(AGENT_CONFIG.ollama);

    const ctx: ToolContext = {
      env: {},
      lang: 'kr',
      cache: new Map(),
      budget: new BudgetTracker({
        maxSubrequests: 50,
        maxLatencyMs: 120000,
        maxLoops: AGENT_CONFIG.caps.maxLoops,
      }),
      provided: [],
      log: (l) => console.error(l),
    };

    const after = await runToolUse({
      systemPrompt: buildPersona(),
      userPrompt: query,
      // ToolSpec<CallMcpArgs>는 orchestrator의 기본 ToolSpec(TArgs=Record<string,unknown>)보다
      // 좁아 구조적으로 대입되지 않는다 — handler가 a?.server 등으로 방어하므로 안전한 캐스팅.
      tools: [callMcp as unknown as ToolSpec],
      caps: AGENT_CONFIG.caps,
      callModel: caller,
      ctx,
      obfuscateToolNames: false,
    });
    const grounding = checkGrounding(after.finalText, ctx.provided as Evidence[]);

    let before: string | undefined;
    if (opts?.before === true) {
      const beforeCtx: ToolContext = {
        env: {},
        lang: 'kr',
        cache: new Map(),
        budget: new BudgetTracker({
          maxSubrequests: 50,
          maxLatencyMs: 120000,
          maxLoops: AGENT_CONFIG.caps.maxLoops,
        }),
        provided: [],
        log: (l) => console.error(l),
      };
      const beforeResult = await runToolUse({
        systemPrompt: buildPersona(),
        userPrompt: query,
        tools: [],
        caps: AGENT_CONFIG.caps,
        callModel: caller,
        ctx: beforeCtx,
        obfuscateToolNames: false,
      });
      before = beforeResult.finalText;
    }

    return {
      after: { finalText: after.finalText, metrics: after.metrics },
      grounding,
      outcomes,
      provided: ctx.provided as Evidence[],
      before,
    };
  } finally {
    await bridge.close();
  }
}

/** argv(query 위치 인자 + `--before` 플래그) 파싱. */
function parseArgs(argv: string[]): { query: string; before: boolean } {
  const before = argv.includes('--before');
  const query = argv.filter((a) => a !== '--before').join(' ');
  return { query, before };
}

/** outcomes(CallRecord[])를 `tool:outcome xN` 집계 문자열로 요약한다. */
function formatOutcomes(outcomes: CallRecord[]): string {
  const counts = new Map<string, number>();
  for (const o of outcomes) {
    const key = `${o.tool}:${o.outcome}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) {
    return '  (없음)';
  }
  return [...counts.entries()].map(([k, v]) => `  ${k} x${v}`).join('\n');
}

/** CLI 진입점 — runQuery 실행 후 결과를 사람이 읽을 형태로 stdout에 출력한다. */
async function main(): Promise<void> {
  const { query, before } = parseArgs(process.argv.slice(2));
  if (!query) {
    console.error('사용법: npm run agent -- "<질의>" [--before]');
    process.exitCode = 1;
    return;
  }

  const result = await runQuery(query, { before });

  console.log('=== after ===');
  console.log(result.after.finalText);

  console.log('\n=== grounding ===');
  console.log(
    `cited=[${result.grounding.citedIds.join(',')}] ` +
      `ungrounded=[${result.grounding.ungroundedIds.join(',')}] ` +
      `groundedRate=${result.grounding.groundedRate.toFixed(2)}`,
  );
  console.log(`surfaceHits: ${result.grounding.surfaceHits.join(', ') || '(없음)'}`);

  console.log('\n=== outcomes ===');
  console.log(formatOutcomes(result.outcomes));

  if (result.before !== undefined) {
    console.log('\n=== before ===');
    console.log(result.before);
  }
}

// 직접 실행(`node run.js` / `tsx src/run.ts`)될 때만 CLI를 구동한다 — import 시(Task 10 e2e 등) 부작용 없음.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(`[agent-lab] 오류: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
