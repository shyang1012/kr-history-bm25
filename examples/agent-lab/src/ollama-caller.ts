/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/ollama-caller.ts
 * @Description: 신규① OllamaModelCaller — OpenAI 호환 /v1/chat/completions 어댑터(ModelCaller 구현).
 *   **표준(primary)**: OpenAI 호환 경로 — 다른 OpenAI 호환 프로바이더에도 이식 가능해 기본으로 둔다.
 *   **fallback**: 네이티브 /api/chat — `think:false`가 OpenAI 호환 경로에서는 무시되고 네이티브에서만
 *   작동함이 경험적으로 확인되어(2026-07-17 R1 재실험), gemma4:e2b 등 thinking 모델의 think 제어가
 *   필요한 경우(`cfg.think`가 명시된 경우)에만 네이티브로 전환한다.
 *   분기: `cfg.think === undefined` → OpenAI 호환(표준). `cfg.think`가 true/false로 명시 → 네이티브 fallback.
 *   두 경로 모두 우리 ChatMessage/ToolCall ↔ 각 형식 양방향 매핑을 수행하고 동일한 ModelTurn을 반환한다:
 *     - OpenAI 호환: tool_calls[].function.arguments는 **문자열**(우리 argumentsJson과 그대로 대응).
 *     - 네이티브: tool_calls[].function.arguments는 **객체** — forward는 JSON.stringify, reverse는
 *       JSON.parse로 우리 argumentsJson(문자열) 규약을 유지한다.
 *   **content-fallback(2026-07-17 R1 실측 추가)**: 소형/중형 모델(kanana 등)은 확률적으로 툴콜을
 *   `tool_calls`가 아니라 `content`에 `{"name":..,"parameters":{...}}` 형태의 JSON 텍스트로 흘린다
 *   (Ollama 파서가 못 잡는 narration). `parseToolCallFromContent`가 이를 복구하고, `applyContentFallback`이
 *   두 경로 공통으로 적용한다 — 정상 tool_calls가 이미 있으면 미적용(정상 우선).
 *   범용 어댑터(도메인 무지) — run.ts가 AGENT_CONFIG.ollama로 orchestrator에 주입한다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */

import type { FunctionSchema } from './orchestrator/registry';
import type { ChatMessage, ModelCaller, ModelTurn, ToolCall } from './orchestrator/types';

/**
 * makeOllamaCaller 설정. baseUrl 미지정 시 로컬 Ollama 기본 포트.
 * think 미지정(undefined) = OpenAI 호환 경로(표준). think 명시(true/false) = 네이티브 /api/chat fallback.
 */
export interface OllamaCallerConfig {
  baseUrl?: string;
  model: string;
  think?: boolean;
}

// --- OpenAI 호환 경로 (표준) ---------------------------------------------------------------

/** OpenAI 호환 tool_call (요청 body 직렬화용). arguments는 문자열. */
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
function toModelTurnFromOpenAi(response: OpenAiChatCompletionResponse): ModelTurn {
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

// --- 네이티브 /api/chat 경로 (think 제어 전용 fallback) --------------------------------------

/** 네이티브 tool_call (요청 body 직렬화용). arguments는 객체(문자열 아님). */
interface OllamaNativeToolCall {
  function: { name: string; arguments: Record<string, unknown> };
}

/** 네이티브 메시지 (요청 body 직렬화용). tool 결과는 content만(tool_call_id 불필요). */
interface OllamaNativeMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  tool_calls?: OllamaNativeToolCall[];
}

/** 네이티브 /api/chat 응답 최소 형태 (필요한 필드만 좁혀 any 회피). */
interface OllamaNativeChatResponse {
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

/** reverse: 우리 ToolCall(argumentsJson=문자열) → 네이티브 tool_call(arguments=객체). 파싱 실패 시 {}. */
function toOllamaNativeToolCall(toolCall: ToolCall): OllamaNativeToolCall {
  let args: Record<string, unknown> = {};
  try {
    args = JSON.parse(toolCall.argumentsJson || '{}') as Record<string, unknown>;
  } catch {
    args = {};
  }
  return { function: { name: toolCall.name, arguments: args } };
}

/** reverse: 우리 ChatMessage[] → 네이티브 메시지[]. */
function toOllamaNativeMessages(messages: ChatMessage[]): OllamaNativeMessage[] {
  return messages.map((m) => ({
    role: m.role,
    content: m.content ?? '',
    tool_calls: m.tool_calls?.map(toOllamaNativeToolCall),
  }));
}

/** 네이티브 usage(prompt_eval_count/eval_count) → 우리 usage. 둘 다 없으면 undefined. */
function toUsageFromNative(response: OllamaNativeChatResponse): Record<string, number> | undefined {
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
function toModelTurnFromNative(response: OllamaNativeChatResponse): ModelTurn {
  const message = response.message;
  const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc, i) => ({
    id: tc.id ?? `call_${i}`,
    name: tc.function.name,
    argumentsJson: JSON.stringify(tc.function.arguments ?? {}),
  }));
  return {
    content: message?.content ?? '',
    toolCalls,
    usage: toUsageFromNative(response),
  };
}

// --- content-fallback (확률적 narration에 흘린 툴콜 JSON 복구) ------------------------------

/** content에서 첫 `{`~마지막 `}`를 추출해 파싱. 실패·비객체면 undefined. */
function extractJsonObject(content: string): Record<string, unknown> | undefined {
  const match = /\{[\s\S]*\}/.exec(content);
  if (!match) {
    return undefined;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(match[0]);
  } catch {
    return undefined;
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

/**
 * content(narration)에 흘린 `{"name":..,"parameters":{...}}`(또는 `arguments`) 형태의 툴콜 JSON을
 * 복구한다. 신호(`parameters`/`arguments`)가 없으면 툴콜이 아니라 판단해 `[]`.
 * name이 tools 목록과 일치하지 않으면(모델이 내부 도구명을 넣은 경우) `tools[0]`(메타도구)로 매핑한다.
 */
export function parseToolCallFromContent(content: string, tools: FunctionSchema[]): ToolCall[] {
  if (content === '') {
    return [];
  }
  const obj = extractJsonObject(content);
  if (!obj) {
    return [];
  }
  const params = obj.parameters ?? obj.arguments;
  if (params === undefined) {
    return [];
  }
  const parsedName = typeof obj.name === 'string' ? obj.name : undefined;
  const knownNames = tools.map((t) => t.function.name);
  let name: string;
  if (parsedName !== undefined && knownNames.includes(parsedName)) {
    name = parsedName;
  } else {
    const first = tools[0];
    name = first ? first.function.name : (parsedName ?? 'call_mcp');
  }
  return [{ id: 'call_fb_0', name, argumentsJson: JSON.stringify(params) }];
}

/** 정상 tool_calls가 없을 때만 content-fallback을 적용(정상 우선). 적용 시 content는 비운다. */
function applyContentFallback(turn: ModelTurn, tools: FunctionSchema[]): ModelTurn {
  if (turn.toolCalls.length > 0) {
    return turn;
  }
  const fallback = parseToolCallFromContent(turn.content, tools);
  if (fallback.length === 0) {
    return turn;
  }
  return { ...turn, toolCalls: fallback, content: '' };
}

// --- 공통 ---------------------------------------------------------------------------------

const DEFAULT_BASE_URL = 'http://localhost:11434';

/** OpenAI 호환 /v1/chat/completions 호출 (표준 경로). */
async function callOpenAiCompat(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  tools: FunctionSchema[],
): Promise<ModelTurn> {
  const res = await fetch(`${baseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: toOpenAiMessages(messages),
      tools,
      tool_choice: 'auto',
    }),
  });

  if (!res.ok) {
    throw new Error(`ollama call failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as OpenAiChatCompletionResponse;
  return applyContentFallback(toModelTurnFromOpenAi(data), tools);
}

/** 네이티브 /api/chat 호출 (think 제어 전용 fallback). */
async function callNative(
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  tools: FunctionSchema[],
  think: boolean,
): Promise<ModelTurn> {
  const res = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: toOllamaNativeMessages(messages),
      tools,
      think,
      stream: false,
    }),
  });

  if (!res.ok) {
    throw new Error(`ollama call failed: ${res.status} ${await res.text()}`);
  }

  const data = (await res.json()) as OllamaNativeChatResponse;
  return applyContentFallback(toModelTurnFromNative(data), tools);
}

/**
 * Ollama ModelCaller. `cfg.think`가 undefined면 OpenAI 호환 /v1/chat/completions(표준),
 * 명시(true/false)면 네이티브 /api/chat(think 제어 fallback)을 사용한다.
 * 응답 !ok 시 상태코드·본문을 담아 throw한다.
 */
export function makeOllamaCaller(cfg: OllamaCallerConfig): ModelCaller {
  const baseUrl = cfg.baseUrl ?? DEFAULT_BASE_URL;

  return async (messages: ChatMessage[], tools: FunctionSchema[]): Promise<ModelTurn> => {
    if (cfg.think === undefined) {
      return callOpenAiCompat(baseUrl, cfg.model, messages, tools);
    }
    return callNative(baseUrl, cfg.model, messages, tools, cfg.think);
  };
}
