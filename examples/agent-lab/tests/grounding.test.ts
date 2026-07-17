/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/grounding.test.ts
 * @Description: GroundingChecker(Task 2) 검증 — [id] 인용 접지/미접지 판정 + surface 정성 라벨.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect } from 'vitest';
import { checkGrounding } from '../src/grounding';

describe('checkGrounding', () => {
  it('인용 [id]가 offered에 있으면 접지', () => {
    const r = checkGrounding('樂浪은 遼東과 공기 [12].', [{ passageId: 12, hanSurface: '樂浪' }]);
    expect(r.ungroundedIds).toEqual([]);
    expect(r.citedIds).toEqual([12]);
  });

  it('offered에 없는 [id]는 미접지(환각 후보)', () => {
    const r = checkGrounding('근거 [99].', [{ passageId: 12, hanSurface: '樂浪' }]);
    expect(r.ungroundedIds).toEqual([99]);
  });

  it('surface 접지는 정성 라벨', () => {
    const r = checkGrounding('樂浪郡 이야기', [{ passageId: 1, hanSurface: '樂浪郡' }]);
    expect(r.surfaceHits).toContain('樂浪郡');
  });
});
