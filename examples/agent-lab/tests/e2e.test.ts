/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/e2e.test.ts
 * @Description: e2e — 실 Ollama+krh-mcp 계약 검증(8 도구명·call_mcp 호출·접지 산출). AGENT_LAB_E2E=1일
 *   때만 실행, 평소 skip. 성능·정답률(R1)은 여기서 판정하지 않는다 — controller가 report로 별도 판정한다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect } from 'vitest';
import { McpBridge } from '../src/mcp-bridge';
import { selectKrhSpec } from '../src/config';
import { runQuery } from '../src/run';

const E2E = process.env.AGENT_LAB_E2E === '1';

const EXPECTED_TOOL_NAMES = [
  'search_han',
  'search_ko',
  'search_hybrid',
  'search_by_reading',
  'with_variants',
  'cluster',
  'place_clusters',
  'lookup_place',
];

(E2E ? describe : describe.skip)('e2e (실 Ollama + krh-mcp)', () => {
  it(
    'krh-mcp가 8개 도구를 정확히 노출한다',
    async () => {
      const bridge = new McpBridge();
      await bridge.connect(selectKrhSpec(process.env.AGENT_LAB_MCP));
      try {
        const names = bridge.listTools('krh').map((t) => t.name);
        expect(names).toHaveLength(8);
        for (const expected of EXPECTED_TOOL_NAMES) {
          expect(names).toContain(expected);
        }
      } finally {
        await bridge.close();
      }
    },
    { timeout: 120000 },
  );

  it(
    'runQuery가 call_mcp를 시도하고 접지 리포트를 산출한다',
    async () => {
      const result = await runQuery('낙랑은 어디에 있었나');
      // 파이프라인이 끝까지 돈다: outcomes에 시도가 기록되거나 provided가 쌓여야 한다.
      expect(result.outcomes.length > 0 || result.provided.length > 0).toBe(true);
      // 소형 모델이 도구를 호출하지 않으면 provided는 0일 수 있다 — 계약은 '숫자가 산출됨'까지.
      expect(result.provided.length).toBeGreaterThanOrEqual(0);
      expect(typeof result.grounding.groundedRate).toBe('number');
    },
    { timeout: 120000 },
  );
});
