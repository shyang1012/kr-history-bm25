/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/ollama-caller.test.ts
 * @Description: OllamaModelCaller(Task 3) 검증 — OpenAI 호환 응답 → ModelTurn 변환(forward),
 *   우리 ToolCall → OpenAI tool_calls 직렬화(reverse) 양방향 매핑을 확인한다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeOllamaCaller } from '../src/ollama-caller';
import type { ChatMessage } from '../src/orchestrator/types';

describe('makeOllamaCaller', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('OpenAI 응답을 ModelTurn으로 변환', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({
        choices: [
          {
            message: {
              content: '',
              tool_calls: [
                { id: 'c1', function: { name: 'call_mcp', arguments: '{"tool":"search_han"}' } },
              ],
            },
          },
        ],
        usage: {},
      }),
    })) as unknown as typeof fetch;

    const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b' });
    const turn = await caller([{ role: 'user', content: 'q' }], []);

    expect(turn.toolCalls[0]).toMatchObject({
      id: 'c1',
      name: 'call_mcp',
      argumentsJson: '{"tool":"search_han"}',
    });
  });

  it('본문만 있고 tool_calls 없으면 toolCalls=[] (최종 답변 턴)', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ choices: [{ message: { content: '답변입니다' } }], usage: {} }),
    })) as unknown as typeof fetch;

    const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b' });
    const turn = await caller([{ role: 'user', content: 'q' }], []);

    expect(turn.content).toBe('답변입니다');
    expect(turn.toolCalls).toEqual([]);
  });

  it('assistant tool_calls(우리 ToolCall)를 OpenAI function.arguments로 역직렬화', async () => {
    let capturedBody: string | undefined;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      capturedBody = init?.body as string;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: 'ok' } }], usage: {} }),
      };
    }) as unknown as typeof fetch;

    const messages: ChatMessage[] = [
      { role: 'user', content: '검색해줘' },
      {
        role: 'assistant',
        content: '',
        tool_calls: [{ id: 'c1', name: 'call_mcp', argumentsJson: '{"tool":"search_han"}' }],
      },
      { role: 'tool', tool_call_id: 'c1', content: '{"result":[]}' },
    ];

    const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b' });
    await caller(messages, []);

    expect(capturedBody).toBeDefined();
    const body = JSON.parse(capturedBody as string) as {
      messages: Array<{ tool_calls?: Array<{ function: { arguments: string } }> }>;
    };
    const assistantMsg = body.messages[1];
    expect(assistantMsg?.tool_calls?.[0]?.function.arguments).toBe('{"tool":"search_han"}');
  });

  it('응답이 !ok면 상태코드·본문을 담아 throw', async () => {
    globalThis.fetch = (async () => ({
      ok: false,
      status: 500,
      text: async () => 'internal error',
    })) as unknown as typeof fetch;

    const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b' });
    await expect(caller([{ role: 'user', content: 'q' }], [])).rejects.toThrow(/500/);
  });
});
