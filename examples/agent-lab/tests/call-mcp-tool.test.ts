/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/call-mcp-tool.test.ts
 * @Description: makeCallMcpTool(Task 5) 검증 — handler 5분기(미발견 tool·args 스키마 위반·
 *   미허용 server(Q-01)·정상 성공·extractEvidence throw) + bridge-error 정규화 + empty-result 분리
 *   (성공≠빈결과, 재시도 힌트용 receivedArgs 포함), 그리고 각 분기의 onOutcome CallOutcome
 *   계측(F-02)을 확인한다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect, vi } from 'vitest';
import { makeCallMcpTool, type CallRecord } from '../src/call-mcp-tool';
import type { ToolInfo } from '../src/mcp-bridge';

const TOOL_INFOS: ToolInfo[] = [
  {
    name: 'search_han',
    description: '한자 원문 BM25 검색',
    inputSchema: {
      type: 'object',
      properties: { term: { type: 'string' } },
      required: ['term'],
    },
  },
];

function makeCtx(): { provided: unknown[]; log: (line: string) => void } {
  return { provided: [], log: () => {} };
}

describe('makeCallMcpTool', () => {
  it('(a) 미발견 tool 호출 → {error} 반환 + unknown-tool emit', async () => {
    const bridge: any = { callTool: vi.fn(), listTools: () => [] };
    const outcomes: CallRecord[] = [];
    const tool = makeCallMcpTool(bridge, TOOL_INFOS, {
      serverIds: ['krh'],
      onOutcome: (r) => outcomes.push(r),
    });
    const ctx: any = makeCtx();
    const result = await tool.handler({ server: 'krh', tool: 'no_such_tool', args: {} }, ctx);
    expect(result).toHaveProperty('error');
    expect(outcomes).toEqual([{ tool: 'no_such_tool', outcome: 'unknown-tool' }]);
    expect(bridge.callTool).not.toHaveBeenCalled();
  });

  it('(b) args 스키마 위반 → {error} 반환 + invalid-args emit', async () => {
    const bridge: any = {
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: '[]' }] })),
      listTools: () => [],
    };
    const outcomes: CallRecord[] = [];
    const tool = makeCallMcpTool(bridge, TOOL_INFOS, {
      serverIds: ['krh'],
      onOutcome: (r) => outcomes.push(r),
    });
    const ctx: any = makeCtx();
    const result = await tool.handler({ server: 'krh', tool: 'search_han', args: {} }, ctx);
    expect(result).toHaveProperty('error');
    expect(outcomes).toEqual([{ tool: 'search_han', outcome: 'invalid-args' }]);
    expect(bridge.callTool).not.toHaveBeenCalled();
  });

  it('(c) 미허용 server → invalid-args emit + bridge.callTool 미호출 (Q-01 회귀)', async () => {
    const bridge: any = {
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: '[]' }] })),
      listTools: () => [],
    };
    const outcomes: CallRecord[] = [];
    const tool = makeCallMcpTool(bridge, TOOL_INFOS, {
      serverIds: ['krh'],
      onOutcome: (r) => outcomes.push(r),
    });
    const ctx: any = makeCtx();
    const result = await tool.handler(
      { server: 'evil', tool: 'search_han', args: { term: '樂浪' } },
      ctx,
    );
    expect(result).toHaveProperty('error');
    expect(outcomes).toEqual([{ tool: 'search_han', outcome: 'invalid-args' }]);
    expect(bridge.callTool).not.toHaveBeenCalled();
  });

  it('(d) 정상 호출 → extractEvidence push + success emit', async () => {
    const bridge: any = {
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: '[]' }] })),
      listTools: () => [],
    };
    const outcomes: CallRecord[] = [];
    const tool = makeCallMcpTool(bridge, TOOL_INFOS, {
      serverIds: ['krh'],
      extractEvidence: () => [{ passageId: 7, hanSurface: '樂浪' }],
      onOutcome: (r) => outcomes.push(r),
    });
    const ctx: any = makeCtx();
    const result = await tool.handler(
      { server: 'krh', tool: 'search_han', args: { term: '樂浪' } },
      ctx,
    );
    expect(result).toEqual({ content: [{ type: 'text', text: '[]' }] });
    expect(ctx.provided).toEqual([{ passageId: 7, hanSurface: '樂浪' }]);
    expect(outcomes).toEqual([{ tool: 'search_han', outcome: 'success' }]);
  });

  it('(e) extractEvidence throw → 예외 삼켜 evidence=[] 취급 → empty-result emit, push 없음', async () => {
    const rawResult = { content: [{ type: 'text', text: '[]' }] };
    const bridge: any = {
      callTool: vi.fn(async () => rawResult),
      listTools: () => [],
    };
    const outcomes: CallRecord[] = [];
    const tool = makeCallMcpTool(bridge, TOOL_INFOS, {
      serverIds: ['krh'],
      extractEvidence: () => {
        throw new Error('adapter boom');
      },
      onOutcome: (r) => outcomes.push(r),
    });
    const ctx: any = makeCtx();
    const args = { term: '樂浪' };
    const result = await tool.handler({ server: 'krh', tool: 'search_han', args }, ctx);
    expect(result).toEqual({
      error: 'empty-result',
      reason: 'EMPTY_RESULT_POSSIBLY_INVALID_ARGS',
      receivedArgs: args,
    });
    expect(ctx.provided).toEqual([]);
    expect(outcomes).toEqual([{ tool: 'search_han', outcome: 'empty-result' }]);
  });

  it('bridge가 {error} 반환 → bridge-error emit + 그 결과 그대로 반환', async () => {
    const bridgeError = { error: 'boom' };
    const bridge: any = { callTool: vi.fn(async () => bridgeError), listTools: () => [] };
    const outcomes: CallRecord[] = [];
    const tool = makeCallMcpTool(bridge, TOOL_INFOS, {
      serverIds: ['krh'],
      onOutcome: (r) => outcomes.push(r),
    });
    const ctx: any = makeCtx();
    const result = await tool.handler(
      { server: 'krh', tool: 'search_han', args: { term: '樂浪' } },
      ctx,
    );
    expect(result).toBe(bridgeError);
    expect(outcomes).toEqual([{ tool: 'search_han', outcome: 'bridge-error' }]);
  });

  it('extractEvidence가 빈 배열 반환(빈 근거) → empty-result emit + receivedArgs 포함 error 반환', async () => {
    const bridge: any = {
      callTool: vi.fn(async () => ({ content: [{ type: 'text', text: '[]' }] })),
      listTools: () => [],
    };
    const outcomes: CallRecord[] = [];
    const tool = makeCallMcpTool(bridge, TOOL_INFOS, {
      serverIds: ['krh'],
      extractEvidence: () => [],
      onOutcome: (r) => outcomes.push(r),
    });
    const ctx: any = makeCtx();
    const args = { term: '없는지명' };
    const result = await tool.handler({ server: 'krh', tool: 'search_han', args }, ctx);
    expect(result).toEqual({
      error: 'empty-result',
      reason: 'EMPTY_RESULT_POSSIBLY_INVALID_ARGS',
      receivedArgs: args,
    });
    expect(ctx.provided).toEqual([]);
    expect(outcomes).toEqual([{ tool: 'search_han', outcome: 'empty-result' }]);
  });
});
