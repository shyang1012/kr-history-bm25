/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/call-mcp-tool.ts
 * @Description: 신규③ call_mcp 메타 ToolSpec 팩토리 — 콜백 주입(DIP)·args 런타임 검증(ajv)·
 *   CallOutcome 계측(F-02)·접지 push. 범용 코어(도메인 무지) — Evidence 등 도메인 타입을
 *   import하지 않는다(F-01). run.ts가 makeCallMcpTool(bridge, toolInfos, opts)로 배선한다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import Ajv from 'ajv';
import type { ToolSpec, ToolContext } from './orchestrator/registry';
import type { McpBridge, ToolInfo } from './mcp-bridge';

// F-01: Evidence 타입 import 금지 — 콜백은 unknown[] 반환(도메인은 배선에서 캐스팅)
/** call_mcp handler 분기 계측(F-02) — §8·§9 지표의 분모/분자. */
export type CallOutcome = 'success' | 'unknown-tool' | 'invalid-args' | 'bridge-error';

/** onOutcome 콜백에 전달되는 계측 1건. */
export interface CallRecord {
  tool: string;
  outcome: CallOutcome;
}

// any 금지 — call_mcp 인자 형상을 명시(orchestrator가 이 shape로 TArgs 전달).
/** call_mcp 도구 인자. */
export interface CallMcpArgs {
  server: string;
  tool: string;
  args: Record<string, unknown>;
}

/** makeCallMcpTool 옵션 — 콜백 주입(DIP)으로 도메인 로직을 배선에서 분리. */
export interface CallMcpOpts {
  serverIds: string[];
  extractEvidence?: (tool: string, result: unknown) => unknown[];
  onOutcome?: (rec: CallRecord) => void;
}

/**
 * MCP 도구를 균일하게 호출하는 메타 ToolSpec을 생성한다.
 *   handler 순서: server allow-list(Q-01) → tool 발견 → args 런타임 검증(ajv) → callTool →
 *   bridge-error 체크 → success + extractEvidence push(예외 삼킴). gate는 두지 않고 모든 분기를
 *   onOutcome으로 계측한다(F-02).
 */
export function makeCallMcpTool(
  bridge: McpBridge,
  toolInfos: ToolInfo[],
  opts: CallMcpOpts,
): ToolSpec<CallMcpArgs> {
  const ajv = new Ajv({ allErrors: true, strict: false });
  const validators = new Map(toolInfos.map((t) => [t.name, ajv.compile(t.inputSchema)]));
  // 각 도구의 필수 arg 키를 description에 노출한다 — 모델이 args를 정확히 구성하게(진단: arg 키 미상 시
  // invalid-args). inputSchema.required 우선, 없으면 properties 키.
  const argHint = (schema: Record<string, unknown>): string => {
    const required = schema.required;
    const properties = schema.properties;
    const keys = Array.isArray(required)
      ? (required as string[])
      : properties && typeof properties === 'object'
        ? Object.keys(properties as Record<string, unknown>)
        : [];
    return keys.length > 0 ? `(args: ${keys.join(', ')})` : '';
  };
  const toolList = toolInfos
    .map((t) => `- ${t.name}${argHint(t.inputSchema)}: ${t.description}`)
    .join('\n');
  return {
    name: 'call_mcp',
    description: `MCP 도구를 호출한다. 사용 가능한 도구:\n${toolList}`,
    parameters: {
      type: 'object',
      properties: {
        server: { type: 'string', enum: opts.serverIds },
        tool: { type: 'string', enum: toolInfos.map((t) => t.name) },
        args: { type: 'object' },
      },
      required: ['server', 'tool', 'args'],
    },
    cost: (): number => 1,
    handler: async (a: CallMcpArgs, ctx: ToolContext): Promise<unknown> => {
      const emit = (outcome: CallOutcome): void => opts.onOutcome?.({ tool: a?.tool, outcome });
      // Q-01: server allow-list 런타임 검증(enum은 LLM 가이드일 뿐 강제 아님 — 미허용 서버가 bridge로 새지 않게)
      if (!opts.serverIds.includes(a?.server)) {
        emit('invalid-args');
        return { error: `unknown server: ${a?.server}` };
      }
      const validate = validators.get(a?.tool);
      if (!validate) {
        emit('unknown-tool');
        return { error: `unknown tool: ${a?.tool}` };
      }
      if (!validate(a.args)) {
        emit('invalid-args');
        return { error: `invalid args for ${a.tool}: ${ajv.errorsText(validate.errors)}` };
      }
      const result: unknown = await bridge.callTool(a.server, a.tool, a.args ?? {});
      if (result && typeof result === 'object' && 'error' in result) {
        emit('bridge-error');
        return result;
      }
      emit('success');
      if (opts.extractEvidence) {
        try {
          ctx.provided.push(...opts.extractEvidence(a.tool, result));
        } catch {
          /* 어댑터 예외 삼킴 */
        }
      }
      return result;
    },
  };
}
