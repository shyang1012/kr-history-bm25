/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/ollama-caller.ts
 * @Description: 신규① OllamaModelCaller — Ollama OpenAI 호환 /v1/chat/completions 어댑터(ModelCaller 구현).
 *   우리 ChatMessage/ToolCall ↔ OpenAI 메시지 형식 양방향 매핑을 담당한다:
 *     - forward: OpenAI 응답 choices[0].message.tool_calls[].function.arguments → ToolCall.argumentsJson
 *     - reverse: assistant 메시지의 ToolCall.argumentsJson → OpenAI tool_calls[].function.arguments
 *   범용 어댑터(도메인 무지) — run.ts가 AGENT_CONFIG.ollama로 orchestrator에 주입한다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */

import type { FunctionSchema } from './orchestrator/registry';
import type { ChatMessage, ModelCaller, ModelTurn, ToolCall } from './orchestrator/types';

/** makeOllamaCaller 설정. baseUrl 미지정 시 로컬 Ollama 기본 포트. */
export interface OllamaCallerConfig {
  baseUrl?: string;
  model: string;
}

/** OpenAI 호환 tool_call (요청 body 직렬화용). */
interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** OpenAI 호환 메시지 (요청 body 직렬화용). */
interface OpenAiMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OpenAiToolCall[];
  tool_call_id?: string;
}

/** /v1/chat/completions 응답 최소 형태 (필요한 필드만 좁혀 any 회피). */
interface OpenAiChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
      tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
    };
  }>;
  usage?: Record<string, number>;
}

const DEFAULT_BASE_URL = 'http://localhost:11434';

/** reverse: 우리 ToolCall → OpenAI tool_calls 원소. */
function toOpenAiToolCall(toolCall: ToolCall): OpenAiToolCall {
  return {
    id: toolCall.id,
    type: 'function',
    function: { name: toolCall.name, arguments: toolCall.argumentsJson },
  };
}

/** reverse: 우리 ChatMessage[] → OpenAI 호환 메시지[]. */
function toOpenAiMessages(messages: ChatMessage[]): OpenAiMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content ?? '',
    tool_calls: m.tool_calls?.map(toOpenAiToolCall),
    tool_call_id: m.tool_call_id,
  }));
}

/** forward: OpenAI 응답 message → 우리 ModelTurn. */
function toModelTurn(response: OpenAiChatCompletionResponse): ModelTurn {
  const message = response.choices?.[0]?.message;
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc) => ({
    id: tc.id,
    name: tc.function.name,
    argumentsJson: tc.function.arguments,
  }));
  return {
    content: message?.content ?? '',
    toolCalls,
    usage: response.usage,
  };
}

/**
 * Ollama(OpenAI 호환 /v1/chat/completions) 기반 ModelCaller.
 *   tool_choice:'auto' 고정. 응답 !ok 시 상태코드·본문을 담아 throw한다.
 */
export function makeOllamaCaller(cfg: OllamaCallerConfig): ModelCaller {
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;

  return async (messages: ChatMessage[], tools: FunctionSchema[]): Promise<ModelTurn> => {
    const res = await fetch(`${baseUrl}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: cfg.model,
        messages: toOpenAiMessages(messages),
        tools,
        tool_choice: 'auto',
      }),
    });

    if (!res.ok) {
      throw new Error(`ollama call failed: ${res.status} ${await res.text()}`);
    }

    const data = (await res.json()) as OpenAiChatCompletionResponse;
    return toModelTurn(data);
  };
}
