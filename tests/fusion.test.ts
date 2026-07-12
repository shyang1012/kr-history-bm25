/**
 * @Project: kr-history-bm25
 * @File: fusion.test.ts
 * @Description: shipped 융합 원시함수(src/search/fusion) 단위 검증 — weightedRrf 가중·dedupe·동점·결정론 +
 *               F-05 authoritative 불변식(사전 arm이 벡터-only 후보보다 상위).
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { describe, it, expect } from 'vitest';
import { rrf, weightedRrf, cosineSim } from '../src/search/fusion';

describe('weightedRrf', () => {
  it('높은 가중 arm의 1위가 낮은 가중 arm의 1위보다 상위', () => {
    const fused = weightedRrf([
      { items: ['x'], weight: 2 },
      { items: ['y'], weight: 1 },
    ]);
    expect(fused[0]!.item).toBe('x');
    expect(fused[0]!.score).toBeCloseTo(2 / 61, 10);
    expect(fused[1]!.score).toBeCloseTo(1 / 61, 10);
  });

  it('여러 arm에 등장하면 가중 점수 합산(dedupe)', () => {
    const fused = weightedRrf([
      { items: ['a', 'b'], weight: 1 },
      { items: ['a'], weight: 3 },
    ]);
    // a = 1/61 + 3/61 = 4/61, b = 1/62
    expect(fused[0]!.item).toBe('a');
    expect(fused[0]!.score).toBeCloseTo(4 / 61, 10);
  });

  it('빈 arm은 무시', () => {
    const fused = weightedRrf([
      { items: [], weight: 5 },
      { items: ['q'], weight: 1 },
    ]);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.item).toBe('q');
  });

  it('동점은 item 오름차순 tie-break(결정론)', () => {
    const fused = weightedRrf([
      { items: ['b'], weight: 1 },
      { items: ['a'], weight: 1 },
    ]);
    expect(fused.map((f) => f.item)).toEqual(['a', 'b']);
  });

  it('동일 입력 동일 출력', () => {
    const input = [
      { items: [10, 20], weight: 2 },
      { items: [20, 30], weight: 1 },
    ];
    expect(weightedRrf(input)).toEqual(weightedRrf(input));
  });

  it('F-05 불변식: 사전(고가중) 정답이 벡터-only(저가중) 후보보다 상위', () => {
    // dict arm(weight 3)이 정답 42를 1위로, vector arm(weight 1)은 무관 99를 1위로
    const fused = weightedRrf([
      { items: [42], weight: 3 }, // dict-han (authoritative)
      { items: [99, 42], weight: 1 }, // vec (recall)
    ]);
    // 42 = 3/61 + 1/62, 99 = 1/61 → 42 > 99
    expect(fused[0]!.item).toBe(42);
  });

  it('k<=0은 오류', () => {
    expect(() => weightedRrf([{ items: ['a'], weight: 1 }], 0)).toThrow();
  });

  it('숫자 passageId 동점은 숫자 오름차순(9 < 10, vectorRank·F-05 계약과 일관)', () => {
    // 9, 10, 100이 각 arm 1위(가중 동일) → 동점 → 숫자순 9,10,100 (문자열순이면 10,100,9)
    const fused = weightedRrf([
      { items: [10], weight: 1 },
      { items: [9], weight: 1 },
      { items: [100], weight: 1 },
    ]);
    expect(fused.map((f) => f.item)).toEqual([9, 10, 100]);
  });
});

describe('cosineSim — Float32Array 수용', () => {
  it('Float32Array 입력도 계산', () => {
    const a = Float32Array.from([1, 2, 3]);
    const b = Float32Array.from([2, 4, 6]);
    expect(cosineSim(a, b)).toBeCloseTo(1, 6);
  });
  it('number[]도 그대로', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });
});

describe('rrf — 이관 후에도 동작', () => {
  it('공통 상위 item이 최고점', () => {
    const fused = rrf([
      ['x', 'y'],
      ['x', 'z'],
    ]);
    expect(fused[0]!.item).toBe('x');
  });
});
