/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/e2e.test.ts
 * @Description: e2e — 실 Ollama+krh-mcp 계약 검증(8 도구명 노출 + runQuery 하네스가 throw 없이
 *   end-to-end 구동). AGENT_LAB_E2E=1일 때만 실행, 평소 skip. 모델의 call_mcp 자율호출 여부·접지
 *   성공률(R1)은 여기서 판정하지 않는다 — eval/report.ts·controller가 실측으로 별도 판정한다.
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
    'runQuery가 throw 없이 하네스를 end-to-end 구동한다',
    async () => {
      // NOTE: 모델의 call_mcp 자율호출 여부는 R1 실험 지표 — eval/report.ts에서 측정, 여기선 하네스
      // 계약(throw 없이 끝까지 돌고 well-formed 결과를 반환하는가)만 검증한다.
      const result = await runQuery('낙랑은 어디에 있었나');
      expect(typeof result.after.finalText).toBe('string');
      expect(Array.isArray(result.outcomes)).toBe(true);
      expect(Array.isArray(result.provided)).toBe(true);
      expect(typeof result.grounding.groundedRate).toBe('number');
    },
    { timeout: 120000 },
  );
});
