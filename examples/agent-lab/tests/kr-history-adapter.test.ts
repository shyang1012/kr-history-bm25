/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/kr-history-adapter.test.ts
 * @Description: krHistoryExtractEvidence(Task 6) 검증 — 도구별 krh-mcp 결과 → Evidence 추출
 *   (search_han 직접 배열·cluster surface만·place_clusters 중첩 flatMap) + 파싱 불가·미지원 도구 폴백.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect } from 'vitest';
import { krHistoryExtractEvidence } from '../src/kr-history-adapter';

describe('krHistoryExtractEvidence', () => {
  it('search_han 결과를 Evidence로', () => {
    const mcp = {
      content: [
        {
          type: 'text',
          text: JSON.stringify([
            { passageId: 5, nodeId: 'n', corpusCode: 'sg', textHan: '樂浪郡', score: 1 },
          ]),
        },
      ],
    };
    expect(krHistoryExtractEvidence('search_han', mcp)).toEqual([
      { passageId: 5, hanSurface: '樂浪郡' },
    ]);
  });

  it('cluster 결과는 surface만', () => {
    const mcp = {
      content: [
        { type: 'text', text: JSON.stringify([{ type: '지명', surface: '遼東', count: 58 }]) },
      ],
    };
    expect(krHistoryExtractEvidence('cluster', mcp)).toEqual([{ hanSurface: '遼東' }]);
  });

  it('place_clusters는 clusters[].members[].surface 추출', () => {
    const mcp = {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            clusters: [{ members: [{ surface: '樂浪' }, { surface: '帶方' }] }],
          }),
        },
      ],
    };
    expect(krHistoryExtractEvidence('place_clusters', mcp)).toEqual([
      { hanSurface: '樂浪' },
      { hanSurface: '帶方' },
    ]);
  });

  it('파싱 불가 텍스트는 빈 배열', () => {
    const mcp = { content: [{ type: 'text', text: 'not json' }] };
    expect(krHistoryExtractEvidence('search_han', mcp)).toEqual([]);
  });

  it('미지원 도구는 빈 배열', () => {
    const mcp = { content: [{ type: 'text', text: JSON.stringify([{ passageId: 1 }]) }] };
    expect(krHistoryExtractEvidence('unknown_tool', mcp)).toEqual([]);
  });
});
