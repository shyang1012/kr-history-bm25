/**
 * @Project: kr-history-bm25
 * @File: place-clusters.ts
 * @Description: seed 유도 국소 퍼지 지명 군집 — 국소 공기 그래프(local-graph)를 Jaccard 유사도로 FDBSCAN
 *               군집한다. parameterMode='auto'는 seed 분포로 파라미터를 추천(suggest)한 뒤 좁은 sweep에서
 *               품질 최고 조합을 결정론적으로 선택한다. 소속도는 그래프 U 내부 계산(전역 아님).
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import type { Client } from '@libsql/client';
import type { PlaceClusterResult, FuzzyMember, FuzzyPlaceCluster } from '../types';
import { loadSimplifiedMap, toSimplified } from '../reading/simplified';
import { fdbscan, type FdbscanResult } from './fdbscan';
import {
  fetchLocalGraph,
  jaccardSim,
  type LocalGraph,
  type PlaceScope,
  type UEntity,
} from './local-graph';
import { suggestPlaceClusterParams } from './suggest-params';

export type { PlaceScope };

/** place-clusters 옵션(단일 옵션 계약) */
export interface PlaceClusterOptions {
  /** 공기 범위(기본 article) */
  scope?: PlaceScope;
  /** 파라미터 모드(기본 fixed). auto=seed별 자동 산정 */
  parameterMode?: 'fixed' | 'auto';
  /** soft eps — 이웃 유사도 하한(fixed) */
  simMin?: number;
  /** 코어 밀도 하한(fixed) */
  muMin?: number;
  /** 엣지 컷 — 최소 공기 unit 수 */
  minCooc?: number;
  /** seed 이웃(U) 상한 */
  limit?: number;
}

/**
 * 기본 파라미터 — scripts/fdbscan-sweep.mjs 게이트로 확정(2026-07-11, 교정 지표 재검증).
 * 튜닝 seed 5종 평균: 군집 ~3.8, 노이즈율 ~0.50, maxFuzzy ~0.38. 희소 seed는 parameterMode:'auto' 권장.
 */
export const DEFAULT_PARAMS = { simMin: 0.12, muMin: 0.5, minCooc: 2, limit: 200 };

const round = (x: number): number => Math.round(x * 1000) / 1000;

/** fdbscan 결과 → 군집(소속도·간자체 병기) + 노이즈 조립(fixed·auto 공유) */
function assembleResult(
  graph: LocalGraph,
  result: FdbscanResult,
  simpMap: Map<string, string>,
): { clusters: FuzzyPlaceCluster[]; noise: string[] } {
  const infoOf = new Map<string, UEntity>(graph.u.map((x) => [x.surface, x]));
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
  for (const x of graph.u) {
    for (const m of result.memberships.get(x.surface) ?? []) {
      byCluster.get(m.clusterId)?.push(member(x.surface, m.membership));
    }
  }
  const clusters = result.clusters.map((clusterId) => ({
    clusterId,
    members: (byCluster.get(clusterId) ?? []).sort(
      (a, b) => b.membership - a.membership || a.surface.localeCompare(b.surface),
    ),
  }));
  return { clusters, noise: [...result.noise].sort() };
}

/** 후보 품질 지표(|U| 정규화) */
function metricsOf(
  uSize: number,
  result: FdbscanResult,
): { noiseRate: number; maxFuzzy: number; borderRate: number } {
  const fuzzySize = new Map<number, number>();
  let border = 0;
  for (const mems of result.memberships.values()) {
    for (const m of mems) {
      fuzzySize.set(m.clusterId, (fuzzySize.get(m.clusterId) ?? 0) + 1);
    }
    if (!(mems.length === 1 && mems[0]?.membership === 1)) {
      border += 1;
    }
  }
  const maxFuzzy = fuzzySize.size ? Math.max(...fuzzySize.values()) / uSize : 0;
  return { noiseRate: result.noise.length / uSize, maxFuzzy, borderRate: border / uSize };
}

/** 후보 점수 — 병리 회피 + 균형(중간 노이즈·비지배 군집·약간의 fuzzy). 높을수록 좋음. 결정론 */
function scoreCandidate(
  clusters: number,
  m: { noiseRate: number; maxFuzzy: number; borderRate: number },
): number {
  if (clusters === 0 || m.noiseRate > 0.9 || m.maxFuzzy > 0.9) {
    return -Infinity; // 병리
  }
  let s = 0;
  s -= Math.abs(m.noiseRate - 0.4); // ~0.4 노이즈 선호
  s -= Math.max(0, m.maxFuzzy - 0.5); // 거대군집 벌점
  s -= clusters >= 2 && clusters <= 6 ? 0 : 0.3; // 군집 2~6 선호
  s += Math.min(m.borderRate, 0.2); // 약간의 fuzzy border 보상
  return s;
}

/**
 * seed 지명의 공기 국소 그래프를 퍼지 군집한다.
 * @param client - libsql 클라이언트
 * @param seed - 기준 지명 표기(한자)
 * @param options - scope·parameterMode·simMin·muMin·minCooc·limit
 * @returns 국소 퍼지 군집 결과(soft 소속도·간자체 병기). auto는 selection 근거 포함
 */
export async function placeClusters(
  client: Client,
  seed: string,
  options: PlaceClusterOptions = {},
): Promise<PlaceClusterResult> {
  const scope: PlaceScope = options.scope ?? 'article';
  const limit = options.limit ?? DEFAULT_PARAMS.limit;

  if (options.parameterMode === 'auto') {
    return placeClustersAuto(client, seed, scope, limit);
  }

  const params = {
    simMin: options.simMin ?? DEFAULT_PARAMS.simMin,
    muMin: options.muMin ?? DEFAULT_PARAMS.muMin,
    minCooc: options.minCooc ?? DEFAULT_PARAMS.minCooc,
    limit,
  };
  const empty: PlaceClusterResult = {
    seed,
    scope,
    params,
    truncated: false,
    clusters: [],
    noise: [],
    selection: { parameterMode: 'fixed' },
  };

  const graph = await fetchLocalGraph(client, seed, {
    scope,
    minCooc: params.minCooc,
    limit,
  });
  if (!graph) {
    return empty;
  }
  if (graph.u.length < 2) {
    return { ...empty, truncated: graph.truncated };
  }

  const result = fdbscan(
    graph.u.map((x) => x.surface),
    jaccardSim(graph),
    {
      simMin: params.simMin,
      muMin: params.muMin,
    },
  );
  const simpMap = await loadSimplifiedMap(client);
  const { clusters, noise } = assembleResult(graph, result, simpMap);
  return {
    seed,
    scope,
    params,
    truncated: graph.truncated,
    clusters,
    noise,
    selection: { parameterMode: 'fixed' },
  };
}

/** auto 모드 — suggest 추천 → 좁은 sweep(simMin/muMin ×{0.7,1,1.5,2.2}) → 품질 최고 선택. 전부 병리면 fixed 폴백 */
async function placeClustersAuto(
  client: Client,
  seed: string,
  scope: PlaceScope,
  limit: number,
): Promise<PlaceClusterResult> {
  const suggest = await suggestPlaceClusterParams(client, seed, { scope, limit });
  if (!suggest) {
    return {
      seed,
      scope,
      params: { ...DEFAULT_PARAMS, limit },
      truncated: false,
      clusters: [],
      noise: [],
      selection: { parameterMode: 'auto' },
    };
  }
  const graph = await fetchLocalGraph(client, seed, { scope, minCooc: suggest.minCooc, limit });
  const selection = {
    parameterMode: 'auto' as const,
    method: suggest.basis.method,
    candidateCount: 16,
    suggested: { minCooc: suggest.minCooc, simMin: suggest.simMin, muMin: suggest.muMin },
  };
  if (!graph || graph.u.length < 2) {
    return {
      seed,
      scope,
      params: { simMin: suggest.simMin, muMin: suggest.muMin, minCooc: suggest.minCooc, limit },
      truncated: graph?.truncated ?? false,
      clusters: [],
      noise: [],
      selection,
    };
  }

  const surfaces = graph.u.map((x) => x.surface);
  const sim = jaccardSim(graph);
  const uSize = surfaces.length;
  // 넓은 배수: 밀집 seed는 더 큰 simMin으로 분리, 희소 seed는 낮게 유지
  const factors = [0.7, 1.0, 1.5, 2.2];

  let best: { score: number; simMin: number; muMin: number; result: FdbscanResult } | null = null;
  for (const fs of factors) {
    for (const fm of factors) {
      const simMin = suggest.simMin * fs;
      const muMin = suggest.muMin * fm;
      const result = fdbscan(surfaces, sim, { simMin, muMin });
      const score = scoreCandidate(result.clusters.length, metricsOf(uSize, result));
      // 결정론 tie-break: 높은 점수 > 낮은 simMin > 낮은 muMin
      if (
        !best ||
        score > best.score ||
        (score === best.score &&
          (simMin < best.simMin || (simMin === best.simMin && muMin < best.muMin)))
      ) {
        best = { score, simMin, muMin, result };
      }
    }
  }
  let chosen = best as { score: number; simMin: number; muMin: number; result: FdbscanResult };

  // 🔴 전 후보가 병리(score=-Infinity)면 sweep가 무의미 — fixed 기본 파라미터로 폴백(무군집 회피).
  let fallback = false;
  if (chosen.score === -Infinity) {
    fallback = true;
    const simMin = DEFAULT_PARAMS.simMin;
    const muMin = DEFAULT_PARAMS.muMin;
    const result = fdbscan(surfaces, sim, { simMin, muMin });
    const score = scoreCandidate(result.clusters.length, metricsOf(uSize, result));
    chosen = { score, simMin, muMin, result };
  }

  const simpMap = await loadSimplifiedMap(client);
  const { clusters, noise } = assembleResult(graph, chosen.result, simpMap);
  return {
    seed,
    scope,
    params: {
      simMin: round(chosen.simMin),
      muMin: round(chosen.muMin),
      minCooc: suggest.minCooc,
      limit,
    },
    truncated: graph.truncated,
    clusters,
    noise,
    selection: {
      ...selection,
      score: round(chosen.score),
      ...(fallback ? { fallback: 'fixed-default' as const } : {}),
    },
  };
}
