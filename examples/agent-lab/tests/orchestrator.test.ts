/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/orchestrator.test.ts
 * @Description: 오케스트레이터 코어 이식(Task 1) 배선 검증 — 도구 없이 최종답 반환 경로(mock ModelCaller).
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect } from 'vitest';
import { runToolUse } from '../src/orchestrator/orchestrator';
import { BudgetTracker } from '../src/orchestrator/registry';
import type { ToolContext } from '../src/orchestrator/registry';

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
});
