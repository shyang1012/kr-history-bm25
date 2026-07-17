/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/ollama-caller.test.ts
 * @Description: OllamaModelCaller(Task 3, 2026-07-17 교정 — OpenAI 호환 primary + 네이티브 think fallback)
 *   검증. `think` 미지정 시 OpenAI 호환 /v1/chat/completions(회귀 보호), `think` 명시 시 네이티브
 *   /api/chat(think 제어)로 분기되는지, 각 경로의 tool_calls 양방향 매핑(문자열 ↔ 객체)을 확인한다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { makeOllamaCaller, parseToolCallFromContent } from '../src/ollama-caller';
import type { ChatMessage } from '../src/orchestrator/types';
import type { FunctionSchema } from '../src/orchestrator/registry';

const CALL_MCP_TOOLS: FunctionSchema[] = [
  { type: 'function', function: { name: 'call_mcp', description: '', parameters: {} } },
];

describe('makeOllamaCaller', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  describe('OpenAI 호환 경로 (think 미지정 — 표준/primary)', () => {
    it('OpenAI 응답을 ModelTurn으로 변환', async () => {
      let capturedUrl: string | undefined;
      globalThis.fetch = (async (url: string) => {
        capturedUrl = url;
        return {
          ok: true,
          json: async () => ({
            choices: [
              {
                message: {
                  content: '',
                  tool_calls: [
                    {
                      id: 'c1',
                      function: { name: 'call_mcp', arguments: '{"tool":"search_han"}' },
                    },
                  ],
                },
              },
            ],
            usage: {},
          }),
        };
      }) as unknown as typeof fetch;

      const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b' });
      const turn = await caller([{ role: 'user', content: 'q' }], []);

      expect(turn.toolCalls[0]).toMatchObject({
        id: 'c1',
        name: 'call_mcp',
        argumentsJson: '{"tool":"search_han"}',
      });
      expect(capturedUrl).toBe('http://x/v1/chat/completions');
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

    it('assistant tool_calls(우리 ToolCall)를 OpenAI function.arguments(문자열)로 역직렬화', async () => {
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

    it('content-fallback: tool_calls가 비고 content에 툴콜 JSON이 흘렀으면 복구한다', async () => {
      globalThis.fetch = (async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"name":"call_mcp","parameters":{"tool":"search_han"}}',
                tool_calls: [],
              },
            },
          ],
          usage: {},
        }),
      })) as unknown as typeof fetch;

      const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b' });
      const turn = await caller([{ role: 'user', content: 'q' }], CALL_MCP_TOOLS);

      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls[0]).toMatchObject({
        name: 'call_mcp',
        argumentsJson: '{"tool":"search_han"}',
      });
      expect(turn.content).toBe('');
    });

    it('content-fallback: 정상 tool_calls가 있으면 미적용(정상 우선)', async () => {
      globalThis.fetch = (async () => ({
        ok: true,
        json: async () => ({
          choices: [
            {
              message: {
                content: '{"name":"call_mcp","parameters":{"tool":"search_han"}}',
                tool_calls: [
                  { id: 'c1', function: { name: 'call_mcp', arguments: '{"tool":"real"}' } },
                ],
              },
            },
          ],
          usage: {},
        }),
      })) as unknown as typeof fetch;

      const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b' });
      const turn = await caller([{ role: 'user', content: 'q' }], CALL_MCP_TOOLS);

      expect(turn.toolCalls).toHaveLength(1);
      expect(turn.toolCalls[0]).toMatchObject({ id: 'c1', argumentsJson: '{"tool":"real"}' });
    });
  });

  describe('네이티브 /api/chat 경로 (think 명시 — think 제어 fallback)', () => {
    it('think:false — 네이티브 응답(arguments=객체)을 ModelTurn(argumentsJson=문자열)으로 변환', async () => {
      let capturedUrl: string | undefined;
      let capturedBody: string | undefined;
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedBody = init?.body as string;
        return {
          ok: true,
          json: async () => ({
            message: {
              content: '',
              tool_calls: [{ function: { name: 'call_mcp', arguments: { tool: 'search_han' } } }],
            },
          }),
        };
      }) as unknown as typeof fetch;

      const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b', think: false });
      const turn = await caller([{ role: 'user', content: 'q' }], []);

      expect(turn.toolCalls[0]).toMatchObject({
        name: 'call_mcp',
        argumentsJson: '{"tool":"search_han"}',
      });
      expect(capturedUrl).toBe('http://x/api/chat');
      const body = JSON.parse(capturedBody as string) as { think: boolean };
      expect(body.think).toBe(false);
    });

    it('think:false — assistant tool_calls(argumentsJson=문자열)를 네이티브 arguments(객체)로 직렬화', async () => {
      let capturedBody: string | undefined;
      globalThis.fetch = (async (_url: string, init?: RequestInit) => {
        capturedBody = init?.body as string;
        return {
          ok: true,
          json: async () => ({ message: { content: 'ok', tool_calls: [] } }),
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

      const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b', think: false });
      await caller(messages, []);

      expect(capturedBody).toBeDefined();
      const body = JSON.parse(capturedBody as string) as {
        messages: Array<{
          tool_calls?: Array<{ function: { arguments: Record<string, unknown> } }>;
        }>;
      };
      const assistantMsg = body.messages[1];
      expect(assistantMsg?.tool_calls?.[0]?.function.arguments).toEqual({ tool: 'search_han' });
    });

    it('think:true를 넘기면 네이티브 경로로 body.think가 true', async () => {
      let capturedUrl: string | undefined;
      let capturedBody: string | undefined;
      globalThis.fetch = (async (url: string, init?: RequestInit) => {
        capturedUrl = url;
        capturedBody = init?.body as string;
        return {
          ok: true,
          json: async () => ({ message: { content: 'ok', tool_calls: [] } }),
        };
      }) as unknown as typeof fetch;

      const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b', think: true });
      await caller([{ role: 'user', content: 'q' }], []);

      expect(capturedUrl).toBe('http://x/api/chat');
      const body = JSON.parse(capturedBody as string) as { think: boolean };
      expect(body.think).toBe(true);
    });

    it('응답이 !ok면 상태코드·본문을 담아 throw', async () => {
      globalThis.fetch = (async () => ({
        ok: false,
        status: 500,
        text: async () => 'internal error',
      })) as unknown as typeof fetch;

      const caller = makeOllamaCaller({ baseUrl: 'http://x', model: 'gemma4:e2b', think: false });
      await expect(caller([{ role: 'user', content: 'q' }], [])).rejects.toThrow(/500/);
    });
  });

  describe('parseToolCallFromContent (확률적 narration에 흘린 툴콜 JSON 복구)', () => {
    it('parameters 필드가 있는 JSON을 툴콜로 복구', () => {
      const content = '{"name":"call_mcp","parameters":{"server":"krh","tool":"search_han"}}';
      const result = parseToolCallFromContent(content, CALL_MCP_TOOLS);

      expect(result).toEqual([
        {
          id: 'call_fb_0',
          name: 'call_mcp',
          argumentsJson: JSON.stringify({ server: 'krh', tool: 'search_han' }),
        },
      ]);
    });

    it('name이 내부 도구명(search_han)이어도 tools=[call_mcp]면 call_mcp로 매핑', () => {
      const content = '{"name":"search_han","parameters":{"server":"krh","tool":"search_han"}}';
      const result = parseToolCallFromContent(content, CALL_MCP_TOOLS);

      expect(result[0]).toMatchObject({ name: 'call_mcp' });
    });

    it('JSON이 없는 순수 텍스트면 []', () => {
      expect(parseToolCallFromContent('그냥 답변입니다', CALL_MCP_TOOLS)).toEqual([]);
    });

    it('parameters/arguments가 없는 JSON이면 [] (툴콜 신호 아님)', () => {
      const content = '{"name":"call_mcp","note":"이건 툴콜이 아님"}';
      expect(parseToolCallFromContent(content, CALL_MCP_TOOLS)).toEqual([]);
    });

    it('빈 문자열이면 []', () => {
      expect(parseToolCallFromContent('', CALL_MCP_TOOLS)).toEqual([]);
    });
  });
});
