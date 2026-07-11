/**
 * @Project: kr-history-bm25
 * @File: place-clusters.ts
 * @Description: seed 유도 국소 퍼지 지명 군집 — 국소 공기 그래프(local-graph)를 Jaccard 유사도로 FDBSCAN
 *               군집한다. 밀도·소속도는 그래프 U 내부에서만 계산(전역 아님). 결과에 간자체 병기·truncated·params.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import type { Client } from '@libsql/client';
import type { PlaceClusterResult, FuzzyMember } from '../types';
import { loadSimplifiedMap, toSimplified } from '../reading/simplified';
import { fdbscan } from './fdbscan';
import { fetchLocalGraph, jaccardSim, type PlaceScope, type UEntity } from './local-graph';

export type { PlaceScope };

/** place-clusters 옵션(단일 옵션 계약) */
export interface PlaceClusterOptions {
  /** 공기 범위(기본 article) */
  scope?: PlaceScope;
  /** soft eps — 이웃 유사도 하한 */
  simMin?: number;
  /** 코어 밀도 하한 */
  muMin?: number;
  /** 엣지 컷 — 최소 공기 unit 수 */
  minCooc?: number;
  /** seed 이웃(U) 상한 */
  limit?: number;
}

/**
 * 기본 파라미터 — scripts/fdbscan-sweep.mjs 게이트로 확정(2026-07-11, 동봉 코퍼스, 교정 지표 재검증).
 * 튜닝 seed 5종 평균: 군집 ~3.8, 노이즈율 ~0.50, maxFuzzy ~0.38(거대 단일군집 없음). 희소 seed는 auto 권장.
 */
export const DEFAULT_PARAMS = { simMin: 0.12, muMin: 0.5, minCooc: 2, limit: 200 };

/**
 * seed 지명의 공기 국소 그래프를 퍼지 군집한다.
 * @param client - libsql 클라이언트
 * @param seed - 기준 지명 표기(한자)
 * @param options - scope·simMin·muMin·minCooc·limit
 * @returns 국소 퍼지 군집 결과(soft 소속도·간자체 병기)
 */
export async function placeClusters(
  client: Client,
  seed: string,
  options: PlaceClusterOptions = {},
): Promise<PlaceClusterResult> {
  const scope: PlaceScope = options.scope ?? 'article';
  const params = {
    simMin: options.simMin ?? DEFAULT_PARAMS.simMin,
    muMin: options.muMin ?? DEFAULT_PARAMS.muMin,
    minCooc: options.minCooc ?? DEFAULT_PARAMS.minCooc,
    limit: options.limit ?? DEFAULT_PARAMS.limit,
  };
  const empty: PlaceClusterResult = {
    seed,
    scope,
    params,
    truncated: false,
    clusters: [],
    noise: [],
  };

  const graph = await fetchLocalGraph(client, seed, {
    scope,
    minCooc: params.minCooc,
    limit: params.limit,
  });
  if (!graph) {
    return empty;
  }
  if (graph.u.length < 2) {
    return { ...empty, truncated: graph.truncated };
  }

  const infoOf = new Map<string, UEntity>(graph.u.map((x) => [x.surface, x]));
  const surfaces = graph.u.map((x) => x.surface);
  const result = fdbscan(surfaces, jaccardSim(graph), {
    simMin: params.simMin,
    muMin: params.muMin,
  });

  // 군집별 멤버 취합(소속도) + 간자체 병기
  const simpMap = await loadSimplifiedMap(client);
  const member = (surface: string, membership: number): FuzzyMember => {
    const info = infoOf.get(surface) as UEntity;
    const s = toSimplified(surface, simpMap);
    return {
      surface,
      type: info.type,
      membership,
      ...(s.changed ? { simplified: s.simplified } : {}),
    };
  };

  const byCluster = new Map<number, FuzzyMember[]>();
  for (const cid of result.clusters) {
    byCluster.set(cid, []);
  }
  for (const surface of surfaces) {
    for (const m of result.memberships.get(surface) ?? []) {
      byCluster.get(m.clusterId)?.push(member(surface, m.membership));
    }
  }
  const clusters = result.clusters.map((clusterId) => ({
    clusterId,
    members: (byCluster.get(clusterId) ?? []).sort(
      (x, y) => y.membership - x.membership || x.surface.localeCompare(y.surface),
    ),
  }));

  return {
    seed,
    scope,
    params,
    truncated: graph.truncated,
    clusters,
    noise: [...result.noise].sort(),
  };
}
