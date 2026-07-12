/**
 * @Project: kr-history-bm25
 * @File: fusion.ts
 * @Description: 하이브리드 검색 융합 원시함수 — RRF·가중 RRF·코사인 유사도. 순수·결정론. BM25·직역·사전·벡터
 *               랭킹을 모델·API 없이 병합한다(정확 층 위 발견 층). shipped 하이브리드(search-hybrid)와
 *               Phase 0 평가 하니스가 공유한다(src/eval/fusion.ts는 본 모듈 re-export).
 * @Author: shyang
 * @LastModified: 2026-07-12
 */

/** RRF 융합 결과 1건 */
export interface FusionScore<T> {
  item: T;
  score: number;
}

/** 가중 RRF 입력 리스트(arm별 랭킹 + 가중) */
export interface WeightedList<T> {
  /** 랭킹된 item 배열(순위순, 중복 없음 가정) */
  items: T[];
  /** arm 가중(사전·BM25 authoritative는 높게, 벡터 recall 보강은 낮게) */
  weight: number;
}

/**
 * 점수 내림차순 + 동점 tie-break(결정론) 정렬. 숫자 item(passageId)은 숫자 오름차순(vectorRank·F-05 계약과
 * 일관 — 9 < 10), 문자열 item은 사전 오름차순.
 */
function sortFused<T extends string | number>(scores: Map<T, number>): FusionScore<T>[] {
  return [...scores.entries()]
    .map(([item, score]) => ({ item, score }))
    .sort((a, b) => {
      if (b.score !== a.score) {
        return b.score - a.score;
      }
      if (typeof a.item === 'number' && typeof b.item === 'number') {
        return a.item - b.item;
      }
      const sa = String(a.item);
      const sb = String(b.item);
      return sa < sb ? -1 : sa > sb ? 1 : 0;
    });
}

/**
 * Reciprocal Rank Fusion — 여러 랭킹 리스트를 순위 역수 합으로 병합한다.
 * score(item) = Σ_lists 1/(k + rank), rank는 각 리스트에서의 1-based 위치(미포함=기여 0).
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
      scores.set(item, (scores.get(item) ?? 0) + 1 / (k + i + 1));
    }
  }
  return sortFused(scores);
}

/**
 * 가중 RRF — arm별 가중을 곱한 순위 역수 합. score(d) = Σ_arm weight_arm/(k + rank_arm(d)).
 * dedupe key=item(passageId), 동점 tie-break=item 오름차순(결정론), 빈 arm(items=[])은 무시.
 * 사전·BM25 arm에 높은 weight를 주면 벡터-only 후보보다 authoritative하게 상위 배치된다(사전 신호 비희석).
 * @param lists - arm별 {items, weight}
 * @param k - RRF 감쇠 상수(표준 60)
 * @returns item·score 배열(융합 순위 내림차순)
 */
export function weightedRrf<T extends string | number>(
  lists: WeightedList<T>[],
  k = 60,
): FusionScore<T>[] {
  if (k <= 0) {
    throw new Error(`weightedRrf: k는 양수여야 합니다(입력: ${k})`);
  }
  const scores = new Map<T, number>();
  for (const { items, weight } of lists) {
    for (let i = 0; i < items.length; i++) {
      const item = items[i]!;
      scores.set(item, (scores.get(item) ?? 0) + weight / (k + i + 1));
    }
  }
  return sortFused(scores);
}

/**
 * 두 벡터의 코사인 유사도. 영벡터(norm 0)는 0을 반환한다. 차원 불일치는 오류.
 * number[]·Float32Array 모두 수용(ArrayLike).
 * @param a - 벡터 A
 * @param b - 벡터 B(A와 같은 차원)
 * @returns 코사인 유사도 ∈ [-1, 1]
 */
export function cosineSim(a: ArrayLike<number>, b: ArrayLike<number>): number {
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
