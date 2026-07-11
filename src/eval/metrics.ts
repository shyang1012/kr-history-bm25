/**
 * @Project: kr-history-bm25
 * @File: metrics.ts
 * @Description: 검색 랭킹 평가 지표 — Recall@K, Reciprocal Rank(MRR 단위), nDCG@K. 이진 관련성(정답셋) 기준,
 *               순수·결정론. krh-cvh Phase 0 평가 하니스가 arm(BM25/벡터/RRF/+리랭커)별 랭킹을 정답셋과
 *               대조해 하이브리드·리랭커 효과를 숫자로 판정하는 데 쓴다. eval 전용(배포 미노출).
 * @Author: shyang
 * @LastModified: 2026-07-12
 */

/**
 * Recall@K — 상위 K 안에 든 정답 비율. 정답셋이 비면 0.
 * @param ranked - 랭킹된 item 배열(순위순)
 * @param relevant - 정답 item 집합
 * @param k - 절단 순위(양수)
 * @returns |ranked[:k] ∩ relevant| / |relevant| ∈ [0, 1]
 */
export function recallAtK<T>(ranked: T[], relevant: Set<T>, k: number): number {
  if (relevant.size === 0) {
    return 0;
  }
  const top = ranked.slice(0, Math.max(0, k));
  let hit = 0;
  for (const item of top) {
    if (relevant.has(item)) {
      hit++;
    }
  }
  return hit / relevant.size;
}

/**
 * Reciprocal Rank — 첫 정답의 순위 역수(1-based). 정답이 하나도 없으면 0.
 * 여러 질의의 평균이 MRR이다(평균은 호출측 책임).
 * @param ranked - 랭킹된 item 배열(순위순)
 * @param relevant - 정답 item 집합
 * @returns 1/rank(첫 정답) ∈ (0, 1], 없으면 0
 */
export function reciprocalRank<T>(ranked: T[], relevant: Set<T>): number {
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i]!)) {
      return 1 / (i + 1);
    }
  }
  return 0;
}

/**
 * nDCG@K — 이진 관련성 정규화 할인 누적 이득. 정답셋이 비면 0.
 * DCG = Σ_{i=1..k} rel_i/log2(i+1), IDCG = 이상적(정답을 상위에 몰았을 때). nDCG = DCG/IDCG.
 * @param ranked - 랭킹된 item 배열(순위순)
 * @param relevant - 정답 item 집합
 * @param k - 절단 순위(양수)
 * @returns nDCG@K ∈ [0, 1]
 */
export function ndcgAtK<T>(ranked: T[], relevant: Set<T>, k: number): number {
  if (relevant.size === 0) {
    return 0;
  }
  const cut = Math.max(0, k);
  let dcg = 0;
  for (let i = 0; i < Math.min(cut, ranked.length); i++) {
    if (relevant.has(ranked[i]!)) {
      dcg += 1 / Math.log2(i + 2);
    }
  }
  const ideal = Math.min(cut, relevant.size);
  let idcg = 0;
  for (let i = 0; i < ideal; i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg === 0 ? 0 : dcg / idcg;
}

/**
 * 산술 평균(빈 배열은 0). arm별 질의 평균(MRR 등) 산출용.
 * @param xs - 수치 배열
 * @returns 평균 ∈ ℝ
 */
export function mean(xs: number[]): number {
  if (xs.length === 0) {
    return 0;
  }
  return xs.reduce((s, x) => s + x, 0) / xs.length;
}
