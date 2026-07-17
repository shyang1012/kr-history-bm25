/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/ollama-caller.ts
 * @Description: 신규① OllamaModelCaller — Ollama 네이티브 /api/chat 어댑터(ModelCaller 구현).
 *   gemma4:e2b 등 thinking 모델은 `think:false`가 OpenAI 호환 /v1/chat/completions에서는 무시되고
 *   네이티브 /api/chat에서만 작동함이 경험적으로 확인되어(2026-07-17 R1 재실험), 엔드포인트를
 *   네이티브로 전환했다(기존 /v1/chat/completions 어댑터 대체).
 *   우리 ChatMessage/ToolCall ↔ 네이티브 메시지 형식 양방향 매핑을 담당한다:
 *     - forward: 네이티브 응답 message.tool_calls[].function.arguments(객체) → ToolCall.argumentsJson(문자열,
 *       JSON.stringify)
 *     - reverse: assistant 메시지의 ToolCall.argumentsJson(문자열) → 네이티브 tool_calls[].function.arguments
 *       (객체, JSON.parse)
 *   범용 어댑터(도메인 무지) — run.ts가 AGENT_CONFIG.ollama로 orchestrator에 주입한다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */

import type { FunctionSchema } from './orchestrator/registry';
import type { ChatMessage, ModelCaller, ModelTurn, ToolCall } from './orchestrator/types';

/** makeOllamaCaller 설정. baseUrl 미지정 시 로컬 Ollama 기본 포트. think 미지정 시 false(추론 비노출). */
export interface OllamaCallerConfig {
  baseUrl?: string;
  model: string;
  think?: boolean;
}

/** 네이티브 /api/chat tool_call (요청 body 직렬화용). arguments는 객체(문자열 아님). */
interface OllamaToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

/** 네이티브 /api/chat 메시지 (요청 body 직렬화용). tool 결과는 content만(tool_call_id 불필요). */
interface OllamaMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OllamaToolCall[];
}

/** /api/chat 응답 최소 형태 (필요한 필드만 좁혀 any 회피). */
interface OllamaChatResponse {
  message?: {
    content?: string | null;
    tool_calls?: Array<{
      id?: string;
      function: { name: string; arguments?: Record<string, unknown> };
    }>;
  };
  prompt_eval_count?: number;
  eval_count?: number;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';

/** reverse: 우리 ToolCall(argumentsJson=문자열) → 네이티브 tool_call(arguments=객체). 파싱 실패 시 {}. */
function toOllamaToolCall(toolCall: ToolCall): OllamaToolCall {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.argumentsJson || '{}') as Record<string, unknown>;
  } catch {
    args = {};
  }
  return { function: { name: toolCall.name, arguments: args } };
}

/** reverse: 우리 ChatMessage[] → 네이티브 메시지[]. */
function toOllamaMessages(messages: ChatMessage[]): OllamaMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content ?? '',
    tool_calls: m.tool_calls?.map(toOllamaToolCall),
  }));
}

/** 네이티브 usage(prompt_eval_count/eval_count) → 우리 usage. 둘 다 없으면 undefined. */
function toUsage(response: OllamaChatResponse): Record<string, number> | undefined {
  if (response.prompt_eval_count === undefined && response.eval_count === undefined) {
    return undefined;
  }
  const usage: Record<string, number> = {};
  if (response.prompt_eval_count !== undefined) {
    usage.prompt_tokens = response.prompt_eval_count;
  }
  if (response.eval_count !== undefined) {
    usage.completion_tokens = response.eval_count;
  }
  return usage;
}

/** forward: 네이티브 응답 message → 우리 ModelTurn. */
function toModelTurn(response: OllamaChatResponse): ModelTurn {
  const message = response.message;
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc, i) => ({
    id: tc.id ?? `call_${i}`,
    name: tc.function.name,
    argumentsJson: JSON.stringify(tc.function.arguments ?? {}),
  }));
  return {
    content: message?.content ?? '',
    toolCalls,
    usage: toUsage(response),
  };
}

/**
 * Ollama 네이티브 /api/chat 기반 ModelCaller. think 기본 false(gemma4:e2b 등 thinking 모델의 추론이
 * content/tool_call을 잠식하는 것을 막는다). 응답 !ok 시 상태코드·본문을 담아 throw한다.
 */
export function makeOllamaCaller(cfg: OllamaCallerConfig): ModelCaller {
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;
  const think = cfg.think ?? false;

  return async (messages: ChatMessage[], tools: FunctionSchema[]): Promise<ModelTurn> => {
    const res = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages: toOllamaMessages(messages),
        tools,
        think,
        stream: false,
      }),
    });

    if (!res.ok) {
      throw new Error(`ollama call failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as OllamaChatResponse;
    return toModelTurn(data);
  };
}
