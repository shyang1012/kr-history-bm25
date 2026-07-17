/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/report.test.ts
 * @Description: aggregateMetrics(Task 9) 검증 — 메타도구 구성 실패율·도구호출 성공률·[id] 인용률·
 *   미접지 id율 공식을 합성 입력(MetricRow[])으로 확인한다. runQuery/Ollama는 호출하지 않는다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect } from 'vitest';
import { aggregateMetrics, type MetricRow } from '../eval/report';

/** GroundingReport 필드를 최소로 채운 헬퍼 — surfaceHits 등 미지정 시 빈 배열. */
function grounding(citedIds: number[], ungroundedIds: number[]): MetricRow['grounding'] {
  const groundedRate = citedIds.length
    ? (citedIds.length - ungroundedIds.length) / citedIds.length
    : 1;
  return { citedIds, ungroundedIds, groundedRate, surfaceHits: [] };
}

describe('aggregateMetrics', () => {
  it('도구호출 성공률 = success / (success + bridge-error)', () => {
    const rows: MetricRow[] = [
      {
        grounding: grounding([], []),
        outcomes: [
          { tool: 'search_han', outcome: 'success' },
          { tool: 'search_han', outcome: 'success' },
          { tool: 'search_han', outcome: 'bridge-error' },
        ],
      },
    ];
    const summary = aggregateMetrics(rows);
    expect(summary.toolCallSuccessRate).toBeCloseTo(2 / 3);
  });

  it('메타도구 구성 실패율 = (unknown-tool + invalid-args) / 총 시도', () => {
    const rows: MetricRow[] = [
      {
        grounding: grounding([], []),
        outcomes: [
          { tool: 'no_such', outcome: 'unknown-tool' },
          { tool: 'search_han', outcome: 'invalid-args' },
          { tool: 'search_han', outcome: 'success' },
          { tool: 'search_han', outcome: 'success' },
        ],
      },
    ];
    const summary = aggregateMetrics(rows);
    expect(summary.toolConfigFailureRate).toBeCloseTo(2 / 4);
  });

  it('[id] 인용률 = citedIds가 있는 질의 수 / 총 질의 수', () => {
    const rows: MetricRow[] = [
      { grounding: grounding([1], []), outcomes: [] },
      { grounding: grounding([], []), outcomes: [] },
      { grounding: grounding([2, 3], []), outcomes: [] },
    ];
    const summary = aggregateMetrics(rows);
    expect(summary.citationRate).toBeCloseTo(2 / 3);
  });

  it('미접지 id율 = Σ ungroundedIds.length / Σ citedIds.length', () => {
    const rows: MetricRow[] = [
      { grounding: grounding([1, 2, 3], [3]), outcomes: [] },
      { grounding: grounding([4], [4]), outcomes: [] },
    ];
    const summary = aggregateMetrics(rows);
    // Σcited = 4, Σungrounded = 2
    expect(summary.ungroundedIdRate).toBeCloseTo(2 / 4);
  });

  it('시도·질의가 0건이면 분모 0 케이스는 관례대로 처리(실패율 0, 성공률 1, 인용률 0, 미접지율 0)', () => {
    const summary = aggregateMetrics([]);
    expect(summary.toolConfigFailureRate).toBe(0);
    expect(summary.toolCallSuccessRate).toBe(1);
    expect(summary.citationRate).toBe(0);
    expect(summary.ungroundedIdRate).toBe(0);
  });
});
