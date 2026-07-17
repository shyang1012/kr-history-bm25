/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/call-mcp-tool.ts
 * @Description: 신규③ call_mcp 메타 ToolSpec 팩토리 — 콜백 주입(DIP)·args 런타임 검증(ajv)·
 *   CallOutcome 계측(F-02)·접지 push. 범용 코어(도메인 무지) — Evidence 등 도메인 타입을
 *   import하지 않는다(F-01). run.ts가 makeCallMcpTool(bridge, toolInfos, opts)로 배선한다.
 *   소형 모델이 인자를 누락/변형해 도구가 빈 결과를 반환하면 "검색 결과 없음"으로 단정하는 사고를
 *   막기 위해, extractEvidence가 정상 파싱 후 빈 배열을 반환하면 empty-result로 분리해 success와
 *   절대 혼동하지 않고 재시도 힌트(orchestrator의 기존 error 재먹임 경로)로 되돌린다. 단 extractEvidence가
 *   throw(어댑터 파싱 버그)하면 empty-result가 아니라 success+raw 유지 — 어댑터 결함을 도구 호출
 *   실패로 오염시키지 않는다(F-01). raw tool call·분기 outcome은 ctx.log로 남겨 빈 결과가 데이터
 *   부재인지 인자 씹음인지 구분할 수 있게 한다(관찰성).
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import Ajv from 'ajv';
import type { ToolSpec, ToolContext } from './orchestrator/registry';
import type { McpBridge, ToolInfo } from './mcp-bridge';

// F-01: Evidence 타입 import 금지 — 콜백은 unknown[] 반환(도메인은 배선에서 캐스팅)
/**
 * call_mcp handler 분기 계측(F-02) — §8·§9 지표의 분모/분자.
 *   empty-result는 도구 호출 자체는 성공(bridge-error 아님)했으나 extractEvidence가 근거를 하나도
 *   못 건진 경우다 — success와 절대 같은 상태로 취급하지 않는다(빈 결과 ≠ 성공).
 */
export type CallOutcome =
  'success' | 'unknown-tool' | 'invalid-args' | 'bridge-error' | 'empty-result';

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
 *   bridge-error 체크 → extractEvidence(1회) → throw면 success+raw 유지(F-01) → 정상 반환 []이면
 *   empty-result 분리 → 그 외 success + 접지 push. gate는 두지 않고 모든 분기를 onOutcome으로
 *   계측한다(F-02). raw 호출·분기 outcome은 ctx.log로 남겨 "빈 결과 vs 인자 씹음"을 사후 구분할 수
 *   있게 한다.
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
      // 원본 tool call 로깅(관찰성) — 빈 결과가 데이터 부재인지 인자 씹음인지 사후 구분 가능하게.
      ctx.log(`[call_mcp] tool=${a.tool} args=${JSON.stringify(a.args)}`);
      const result: unknown = await bridge.callTool(a.server, a.tool, a.args ?? {});
      if (result && typeof result === 'object' && 'error' in result) {
        emit('bridge-error');
        ctx.log('  → bridge-error');
        return result;
      }
      // extractEvidence는 여기서 1회만 호출해 재사용한다(중복 호출 금지) — 결과로 success/empty-result 분기.
      // 🔴 F-01: 어댑터 throw(파싱 버그)와 정상 반환 []( 근거 정말 없음)는 의미가 다르다 — throw는
      // 어댑터 결함이라 raw에 데이터가 있을 수 있고 재시도해도 같은 버그가 반복되므로 success+raw로
      // 유지한다. empty-result는 정상 파싱했는데 근거가 0건일 때만 성립한다.
      let evidence: unknown[] = [];
      let extractFailed = false;
      if (opts.extractEvidence) {
        try {
          evidence = opts.extractEvidence(a.tool, result);
        } catch {
          extractFailed = true;
        }
      }
      if (extractFailed) {
        emit('success');
        ctx.log('  → success (extract 실패 — raw 유지)');
        return result;
      }
      // 🔴 "검색 결과 없음"과 "도구 호출 실패"를 같은 상태로 취급하지 않는다 — 근거가 0건이면 empty-result로
      // 분리해 error를 되먹인다. orchestrator의 기존 재시도 경로('error' in result)가 _retry_hint를 붙여
      // 모델에 되돌려주므로, 모델이 receivedArgs를 보고 인자를 고쳐 재호출할 수 있다.
      if (opts.extractEvidence && evidence.length === 0) {
        emit('empty-result');
        ctx.log('  → empty-result (인자 의심)');
        return {
          error: 'empty-result',
          reason: 'EMPTY_RESULT_POSSIBLY_INVALID_ARGS',
          receivedArgs: a.args,
        };
      }
      emit('success');
      ctx.log(`  → success (${evidence.length} evidence)`);
      ctx.provided.push(...evidence);
      return result;
    },
  };
}
