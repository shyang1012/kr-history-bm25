/**
 * @Project: kr-history-bm25
 * @File: fusion.ts
 * @Description: 하이브리드 검색 융합 원시함수 — RRF(Reciprocal Rank Fusion)와 코사인 유사도. 순수·결정론.
 *               BM25 랭킹과 벡터 랭킹을 모델·API 없이 병합한다(정확 층 위 발견 층). krh-cvh Phase 0 평가
 *               하니스가 쓰고, 빌드 단계의 shipped 하이브리드로 재사용될 후보다.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */

/** RRF 융합 결과 1건 */
export interface FusionScore<T> {
  item: T;
  score: number;
}

/**
 * Reciprocal Rank Fusion — 여러 랭킹 리스트를 순위 역수 합으로 병합한다.
 * score(item) = Σ_lists 1/(k + rank), rank는 각 리스트에서의 1-based 위치(미포함=기여 0).
 * 점수 내림차순 정렬, 동점은 item의 문자열 표현 오름차순으로 tie-break(결정론).
 * @param rankedLists - 랭킹된 item 배열들(각 배열은 순위순, 중복 없음 가정)
 * @param k - RRF 감쇠 상수(표준 60)
 * @returns item·score 배열(융합 순위 내림차순)
 */
export function rrf<T extends string | number>(rankedLists: T[][], k = 60): FusionScore<T>[] {
  if (k <= 0) {
    throw new Error(`rrf: k는 양수여야 합니다(입력: ${k})`);
  }
  const scores = new Map<T, number>();
  for (const list of rankedLists) {
    for (let i = 0; i < list.length; i++) {
      const item = list[i]!;
      const rank = i + 1;
      scores.set(item, (scores.get(item) ?? 0) + 1 / (k + rank));
    }
  }
  return [...scores.entries()]
    .map(([item, score]) => ({ item, score }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      const sa = String(a.item);
      const sb = String(b.item);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
}

/**
 * 두 벡터의 코사인 유사도. 영벡터(norm 0)는 0을 반환한다. 차원 불일치는 오류.
 * @param a - 벡터 A
 * @param b - 벡터 B(A와 같은 차원)
 * @returns 코사인 유사도 ∈ [-1, 1]
 */
export function cosineSim(a: number[], b: number[]): number {
  if (a.length !== b.length) {
    throw new Error(`cosineSim: 차원 불일치(${a.length} vs ${b.length})`);
  }
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) {
    return 0;
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
