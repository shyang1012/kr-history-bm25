/**
 * @Project: kr-history-bm25
 * @File: eval-metrics.test.ts
 * @Description: 검색 지표(Recall@K·RR·nDCG@K·mean) 단위 검증 — 손으로 만든 랭킹·정답셋으로 기지값·엣지 고정.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { describe, it, expect } from 'vitest';
import { recallAtK, reciprocalRank, ndcgAtK, mean } from '../src/eval/metrics';

describe('recallAtK', () => {
  it('상위 K 안의 정답 비율', () => {
    const ranked = [1, 2, 3, 4, 5];
    const rel = new Set([2, 4, 9]); // 9는 코퍼스에 없음
    // top3 = [1,2,3], 교집합 {2} → 1/3
    expect(recallAtK(ranked, rel, 3)).toBeCloseTo(1 / 3, 10);
    // top5 → {2,4} → 2/3
    expect(recallAtK(ranked, rel, 5)).toBeCloseTo(2 / 3, 10);
  });

  it('정답셋이 비면 0', () => {
    expect(recallAtK([1, 2], new Set<number>(), 5)).toBe(0);
  });

  it('K=0이면 0', () => {
    expect(recallAtK([1, 2], new Set([1]), 0)).toBe(0);
  });
});

describe('reciprocalRank', () => {
  it('첫 정답 순위의 역수', () => {
    expect(reciprocalRank([9, 8, 2, 1], new Set([2]))).toBeCloseTo(1 / 3, 10);
  });

  it('1위가 정답이면 1', () => {
    expect(reciprocalRank([5, 6], new Set([5]))).toBe(1);
  });

  it('정답 없으면 0', () => {
    expect(reciprocalRank([1, 2, 3], new Set([9]))).toBe(0);
  });
});

describe('ndcgAtK', () => {
  it('정답이 1위에 모이면 1', () => {
    // ranked 상위 2개가 정답, 정답셋 크기 2 → DCG=IDCG → 1
    expect(ndcgAtK([1, 2, 3], new Set([1, 2]), 3)).toBeCloseTo(1, 10);
  });

  it('정답이 뒤로 밀리면 1 미만', () => {
    // ranked=[3,1,2], 정답={1,2} → DCG=1/log2(3)+1/log2(4), IDCG=1/log2(2)+1/log2(3)
    const dcg = 1 / Math.log2(3) + 1 / Math.log2(4);
    const idcg = 1 / Math.log2(2) + 1 / Math.log2(3);
    expect(ndcgAtK([3, 1, 2], new Set([1, 2]), 3)).toBeCloseTo(dcg / idcg, 10);
  });

  it('정답셋이 비면 0', () => {
    expect(ndcgAtK([1, 2], new Set<number>(), 5)).toBe(0);
  });
});

describe('mean', () => {
  it('산술 평균', () => {
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });
  it('빈 배열은 0', () => {
    expect(mean([])).toBe(0);
  });
});
