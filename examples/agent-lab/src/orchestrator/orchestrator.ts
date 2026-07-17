/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/orchestrator/orchestrator.ts
 * @Description: code-wiz cw-owt9 이식(2026-07-17) — tool-use 2계층: 멀티라운드 루프 + 횡단 가드레일
 *   오케스트레이터. 범용 코어(R6 격리) — kr-history 도메인 타입을 import하지 않는다.
 *     - 멀티라운드 루프: 도구 호출이 없어질 때까지 callModel ↔ tool 실행 반복
 *     - BudgetTracker 연동: latency 초과 / budget 소진 시 도구 중단
 *     - loop cap 가드레일: maxLoops 소진 시 truncatedByLoopCap = true
 *     - perToolCallCap: 도구별 호출 횟수 상한 (절제된 grep 등)
 *     - gate 통과 실패 / 미등록 도구 → tool result error (handler 미호출)
 *     - 도구 실패 재시도: 소형 모델이 확률적으로 인자를 뭉개는 경우를 대비해 error result에 재시도 힌트를
 *       되먹여(_retry_hint) 모델이 인자를 고쳐 다시 호출하게 한다. maxToolRetries(기본 10) 소진 시
 *       retriesExhausted=true로 정직히 중단하고, 빈 finalText는 정직 마무리 문구로 대체한다.
 *   원본의 URL 환각검출 블록(offeredUrls/citedUrls/hallucinatedUrls)은 제거했다 — 도메인 무관 코어에는
 *   해당하지 않으며, agent 레이어의 접지 지표(grounding)가 대체한다.
 *   도구명 난독화(aliasOf/realOf)는 `obfuscateToolNames` 옵션으로 이식했다. 기본값 false — 본 하네스는
 *   페르소나·few-shot이 call_mcp 실명 호출을 가르치므로, 소형 모델 혼란을 막기 위해 스키마명도 실명을 쓴다.
 *   orchestrator는 특정 모델 백엔드를 직접 import하지 않고 ModelCaller로 의존성 역전(테스트 mock 용이).
 * @Author: shyang
 * @LastModified: 2026-07-17
 */

import type { ToolSpec, ToolContext, FunctionSchema } from './registry';
import type {
  ChatMessage,
  ModelCaller,
  OrchestratorCaps,
  OrchestratorResult,
  ToolUseMetrics,
} from './types';
import { stripInternalToolLeak } from './sanitize-tool-leak';

/** runToolUse 인자 */
export interface RunToolUseArgs {
  systemPrompt: string;
  userPrompt: string;
  tools: ToolSpec[];
  caps: OrchestratorCaps;
  callModel: ModelCaller;
  ctx: ToolContext;
  /** 🔴 멀티턴 세션 이력 (helpdesk 역질문·세션 등). system과 user 사이에 삽입. */
  history?: ChatMessage[];
  /** 🔴 도구 실행 직전 콜백 — 호출자가 status 이벤트로 변환할 때 사용. raw reasoning 비노출. */
  onToolStart?: (toolName: string) => void;
  /**
   * 도구명 난독화(t1,t2… opaque 이름) 사용 여부. 기본 false(실명 노출).
   * 페르소나가 call_mcp 실명 호출을 가르치는 하네스에서는 off를 유지해야 소형 모델이 혼란 없이 호출한다.
   */
  obfuscateToolNames?: boolean;
}

/** AbortError — orchestrator 루프가 ctx.signal abort 감지 시 throw. */
export class ToolUseAbortError extends Error {
  constructor() {
    super('tool-use aborted by signal');
    this.name = 'ToolUseAbortError';
  }
}

/**
 * 멀티라운드 tool-use 오케스트레이터.
 *   - callModel이 toolCalls=[] 를 반환하면 최종 답변으로 종료
 *   - maxLoops 소진 전 도구 호출 중이면 truncatedByLoopCap=true
 *   - error result가 maxToolRetries(기본 10)만큼 누적되면 retriesExhausted=true로 조기 중단
 */
export async function runToolUse(args: RunToolUseArgs): Promise<OrchestratorResult> {
  const { systemPrompt, userPrompt, tools, caps, callModel, ctx, history, onToolStart } = args;
  const obfuscate = args.obfuscateToolNames ?? false;
  const maxToolRetries = caps.maxToolRetries ?? 10;

  // --- 메시지 초기화 (system → [멀티턴 history] → user) ---
  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt },
    ...(history ?? []),
    { role: 'user', content: userPrompt },
  ];

  // --- 🔴 도구명 난독화 (obfuscateToolNames=true일 때만) ---
  //   opaque 모드: 모델에는 의미 없는 opaque ID(t1,t2…)만 노출 → 내부 실명을 아예 모름.
  //   off(기본) 모드: aliasOf/realOf가 항등 매핑 — functionSchemas·dispatch 모두 실명 기준.
  const aliasOf = new Map<string, string>(); // realName → 노출명
  const realOf = new Map<string, string>(); // 노출명 → realName
  tools.forEach((t, i) => {
    const exposedName = obfuscate ? `t${i + 1}` : t.name;
    aliasOf.set(t.name, exposedName);
    realOf.set(exposedName, t.name);
  });

  // --- FunctionSchema 변환 (OpenAI 호환, obfuscate=false면 실명) ---
  const functionSchemas: FunctionSchema[] = tools.map((t) => ({
    type: 'function',
    function: {
      name: aliasOf.get(t.name) ?? t.name,
      description: t.description,
      parameters: t.parameters,
    },
  }));

  // --- metrics 초기화 ---
  const metrics: ToolUseMetrics = {
    modelCalls: 0,
    toolCalls: {},
    fetchCount: 0,
    subrequestEstimate: 0,
    latencyMs: 0,
    truncatedByLoopCap: false,
    truncatedByLatency: false,
  };

  // --- perToolCallCap 누적 추적 ---
  const toolCallCount: Record<string, number> = {};

  // --- 도구 map (이름 → ToolSpec) ---
  const toolMap = new Map<string, ToolSpec>(tools.map((t) => [t.name, t]));

  // --- budget spend 누적 (subrequestEstimate용) ---
  let budgetSpent = 0;

  // --- 도구 실패 재시도 누적 (maxToolRetries 소진 판정용, 성공 호출은 무관) ---
  let toolErrorCount = 0;

  let finalText = '';

  for (let loop = 0; loop < caps.maxLoops; loop++) {
    // 🔴 client abort 전파 — 루프 진입 시 중단
    if (ctx.signal?.aborted) {
      throw new ToolUseAbortError();
    }
    // latency 초과 조기 degrade
    if (ctx.budget.latencyExceeded()) {
      metrics.truncatedByLatency = true;
      break;
    }

    // 모델 1턴 호출
    const turn = await callModel(messages, functionSchemas);
    metrics.modelCalls++;

    // usage merge
    if (turn.usage) {
      metrics.usage = { ...(metrics.usage ?? {}), ...turn.usage };
    }

    // assistant 메시지 누적
    messages.push({
      role: 'assistant',
      content: turn.content ?? '',
      tool_calls: turn.toolCalls.length > 0 ? turn.toolCalls : undefined,
    });

    // 도구 호출 없으면 최종 답변
    if (turn.toolCalls.length === 0) {
      finalText = turn.content ?? '';
      break;
    }

    // 각 도구 호출 처리
    for (const toolCall of turn.toolCalls) {
      // 🔴 난독화 역매핑 — 모델이 부른 노출명을 실명으로 복원(off 모드는 항등).
      //   이후 spec조회·cap·metrics·onToolStart는 모두 realName 기준(내부 관측 일관).
      const realName = realOf.get(toolCall.name) ?? toolCall.name;

      // 🔴 도구 실행 직전 콜백 — 호출자가 status로 변환. raw reasoning 비노출.
      onToolStart?.(realName);

      let result: unknown;

      const spec = toolMap.get(realName);

      if (!spec) {
        // 미등록 도구
        result = { error: `unknown tool: ${realName}` };
      } else {
        // 인자 parse
        let parsedArgs: Record<string, unknown> = {};
        try {
          parsedArgs = JSON.parse(toolCall.argumentsJson) as Record<string, unknown>;
        } catch {
          parsedArgs = {};
        }

        // perToolCallCap 체크
        const callsSoFar = toolCallCount[realName] ?? 0;
        const cap = caps.perToolCallCap?.[realName];
        if (cap !== undefined && callsSoFar >= cap) {
          result = { error: `tool call cap exceeded: ${realName} (cap=${cap})` };
        } else {
          // gate 체크
          const gateResult = spec.gate ? spec.gate(parsedArgs, ctx) : { ok: true as const };
          if (!gateResult.ok) {
            result = { error: (gateResult as { ok: false; reason: string }).reason };
          } else {
            // budget 체크
            const cost = spec.cost(parsedArgs, ctx);
            if (!ctx.budget.canSpend(cost)) {
              result = { error: 'budget exceeded' };
            } else {
              // 도구 실행
              result = await spec.handler(parsedArgs, ctx);
              ctx.budget.spend(cost);
              budgetSpent += cost;

              // metrics 집계 (실명 기준 — 내부 관측 일관)
              metrics.toolCalls[realName] = (metrics.toolCalls[realName] ?? 0) + 1;
              toolCallCount[realName] = callsSoFar + 1;

              // cost > 0이면 fetch 추정
              if (cost > 0) {
                metrics.fetchCount++;
              }
            }
          }
        }
      }

      // 🔴 error result면 재시도 카운트 + 모델에 인자 수정을 유도하는 힌트를 되먹인다.
      const isError =
        result !== null && typeof result === 'object' && 'error' in (result as object);
      if (isError) {
        toolErrorCount++;
      }
      const content = isError
        ? JSON.stringify({
            ...(result as Record<string, unknown>),
            _retry_hint:
              '도구 호출이 실패했습니다. 위 오류를 확인해 인자(args)를 수정한 뒤 같은 도구를 다시 호출하세요.',
          })
        : JSON.stringify(result);

      // tool result 메시지 추가
      messages.push({
        role: 'tool',
        tool_call_id: toolCall.id,
        content,
      });
    }

    // 🔴 재시도 소진 — 소형 모델이 인자를 계속 뭉개면 무한 루프 대신 정직히 중단한다.
    if (toolErrorCount >= maxToolRetries) {
      metrics.retriesExhausted = true;
      break;
    }

    // 마지막 loop인데 도구 호출 중이었으면 loop cap 소진
    if (loop === caps.maxLoops - 1) {
      metrics.truncatedByLoopCap = true;
    }
  }

  // --- 종료 후 metrics 확정 ---
  metrics.latencyMs = ctx.budget.elapsedMs();
  metrics.subrequestEstimate = metrics.modelCalls + budgetSpent;

  // 🔴 정직 마무리 — 재시도·loop cap 소진으로 답을 못 만들었으면 침묵 대신 정직히 보고한다.
  if (finalText === '' && (metrics.retriesExhausted || metrics.truncatedByLoopCap)) {
    finalText = '도구를 여러 번 시도했으나 사용하지 못했습니다.';
  }

  // 🔴 응답 필터 하네스 — finalText에 내부 도구 실명/opaque 호출이 새면 결정론적 제거.
  //   난독화(옵션 on) · 프롬프트 하드닝이 1차 차단, 본 필터가 backstop.
  const guard = stripInternalToolLeak(
    finalText,
    tools.map((t) => t.name),
  );
  if (guard.leaked) {
    ctx.log('🔴 internal tool leak stripped from finalText');
    metrics.toolLeakStripped = true;
  }
  finalText = guard.text;

  return {
    finalText,
    providedSources: ctx.provided,
    metrics,
  };
}
