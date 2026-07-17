/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/orchestrator.test.ts
 * @Description: 오케스트레이터 코어 이식(Task 1) 배선 검증 — 도구 없이 최종답 반환 경로(mock ModelCaller) +
 *   도구명 노출·dispatch 회귀(#2 난독화 off/on) + 도구 실패 재시도(maxToolRetries) 회귀.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect } from 'vitest';
import { runToolUse } from '../src/orchestrator/orchestrator';
import { BudgetTracker } from '../src/orchestrator/registry';
import type { ToolContext, ToolSpec } from '../src/orchestrator/registry';
import type { ChatMessage, ModelCaller } from '../src/orchestrator/types';

const ctx = (): ToolContext => ({
  env: {},
  lang: 'kr' as const,
  cache: new Map(),
  budget: new BudgetTracker({ maxSubrequests: 50, maxLatencyMs: 60000, maxLoops: 5 }),
  provided: [],
  log: () => {},
});

describe('runToolUse', () => {
  it('도구 없이 최종답 반환', async () => {
    const callModel = async (): Promise<{
      content: string;
      toolCalls: never[];
      usage: Record<string, number>;
    }> => ({ content: '답변', toolCalls: [], usage: {} });
    const r = await runToolUse({
      systemPrompt: 's',
      userPrompt: 'u',
      tools: [],
      caps: { maxLoops: 5 },
      callModel,
      ctx: ctx(),
    });
    expect(r.finalText).toBe('답변');
  });

  it('off(기본) — 실명 노출 + dispatch', async () => {
    let handlerCalled = false;
    let capturedName = '';
    const tool: ToolSpec = {
      name: 'call_mcp',
      description: 'd',
      parameters: { type: 'object' },
      cost: () => 0,
      handler: async () => {
        handlerCalled = true;
        return { ok: true };
      },
    };
    let callCount = 0;
    const callModel: ModelCaller = async (_messages, tools) => {
      callCount++;
      if (callCount === 1) {
        capturedName = tools[0]?.function.name ?? '';
        return { content: '', toolCalls: [{ id: 'c1', name: 'call_mcp', argumentsJson: '{}' }] };
      }
      return { content: '답변', toolCalls: [] };
    };
    const r = await runToolUse({
      systemPrompt: 's',
      userPrompt: 'u',
      tools: [tool],
      caps: { maxLoops: 5 },
      callModel,
      ctx: ctx(),
    });
    expect(capturedName).toBe('call_mcp');
    expect(handlerCalled).toBe(true);
    expect(r.finalText).toBe('답변');
  });

  it('on(true) — t1 노출 + dispatch(realOf 복원)', async () => {
    let handlerCalled = false;
    let capturedName = '';
    const tool: ToolSpec = {
      name: 'call_mcp',
      description: 'd',
      parameters: { type: 'object' },
      cost: () => 0,
      handler: async () => {
        handlerCalled = true;
        return { ok: true };
      },
    };
    let callCount = 0;
    const callModel: ModelCaller = async (_messages, tools) => {
      callCount++;
      if (callCount === 1) {
        capturedName = tools[0]?.function.name ?? '';
        return { content: '', toolCalls: [{ id: 'c1', name: 't1', argumentsJson: '{}' }] };
      }
      return { content: '답변', toolCalls: [] };
    };
    const r = await runToolUse({
      systemPrompt: 's',
      userPrompt: 'u',
      tools: [tool],
      caps: { maxLoops: 5 },
      callModel,
      ctx: ctx(),
      obfuscateToolNames: true,
    });
    expect(capturedName).toBe('t1');
    expect(handlerCalled).toBe(true);
    expect(r.finalText).toBe('답변');
  });
});

describe('runToolUse — 도구 실패 재시도(maxToolRetries)', () => {
  it('(a) 재시도 소진 시 조기 중단 + 정직 마무리', async () => {
    const tool: ToolSpec = {
      name: 'call_mcp',
      description: 'd',
      parameters: { type: 'object' },
      cost: () => 0,
      handler: async () => ({ error: 'invalid args' }),
    };
    const callModel: ModelCaller = async (_messages, _tools) => ({
      content: '',
      toolCalls: [{ id: 'c1', name: 'call_mcp', argumentsJson: '{}' }],
    });
    const r = await runToolUse({
      systemPrompt: 's',
      userPrompt: 'u',
      tools: [tool],
      caps: { maxLoops: 10, maxToolRetries: 3 },
      callModel,
      ctx: ctx(),
    });
    expect(r.metrics.retriesExhausted).toBe(true);
    expect(r.finalText).toBe('도구를 여러 번 시도했으나 사용하지 못했습니다.');
  });

  it('(b) 에러 tool result에 _retry_hint가 되먹여진다', async () => {
    const tool: ToolSpec = {
      name: 'call_mcp',
      description: 'd',
      parameters: { type: 'object' },
      cost: () => 0,
      handler: async () => ({ error: 'invalid args' }),
    };
    let capturedMessages: ChatMessage[] = [];
    let callCount = 0;
    const callModel: ModelCaller = async (messages) => {
      callCount++;
      if (callCount === 2) {
        capturedMessages = messages;
      }
      return {
        content: '',
        toolCalls: [{ id: `c${callCount}`, name: 'call_mcp', argumentsJson: '{}' }],
      };
    };
    await runToolUse({
      systemPrompt: 's',
      userPrompt: 'u',
      tools: [tool],
      caps: { maxLoops: 10, maxToolRetries: 3 },
      callModel,
      ctx: ctx(),
    });
    const toolMessage = capturedMessages.find((m) => m.role === 'tool');
    expect(toolMessage).toBeDefined();
    const parsed = JSON.parse(toolMessage?.content ?? '{}') as Record<string, unknown>;
    expect(typeof parsed._retry_hint).toBe('string');
  });

  it('(c) 정상 흐름(툴콜 1회 성공 후 무툴 최종답)은 기존과 동일', async () => {
    let handlerCalled = false;
    const tool: ToolSpec = {
      name: 'call_mcp',
      description: 'd',
      parameters: { type: 'object' },
      cost: () => 0,
      handler: async () => {
        handlerCalled = true;
        return { ok: true };
      },
    };
    let callCount = 0;
    const callModel: ModelCaller = async () => {
      callCount++;
      if (callCount === 1) {
        return { content: '', toolCalls: [{ id: 'c1', name: 'call_mcp', argumentsJson: '{}' }] };
      }
      return { content: '답변', toolCalls: [] };
    };
    const r = await runToolUse({
      systemPrompt: 's',
      userPrompt: 'u',
      tools: [tool],
      caps: { maxLoops: 5 },
      callModel,
      ctx: ctx(),
    });
    expect(handlerCalled).toBe(true);
    expect(r.finalText).toBe('답변');
    expect(r.metrics.retriesExhausted).toBeFalsy();
  });
});
