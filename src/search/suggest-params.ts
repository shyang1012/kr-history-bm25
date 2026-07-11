/**
 * @Project: kr-history-bm25
 * @File: suggest-params.ts
 * @Description: seed별 FDBSCAN 파라미터 결정론적 추천 — 국소 그래프의 공기 빈도·Jaccard·밀도 분포에서
 *               minCooc(로그스케일)·simMin(유사도 분위수)·muMin(밀도 분위수)을 추정한다(강화학습 아님).
 *               추천만 하며 실제 군집은 호출자가 결정(Phase 2). 동일 입력 → 동일 추천(재현성).
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import type { Client } from '@libsql/client';
import { fetchLocalGraph, jaccardSim, type PlaceScope } from './local-graph';

/** 추천 파라미터 + 근거 */
export interface SuggestedParams {
  /** 엣지 컷(공기 하한) */
  minCooc: number;
  /** soft eps(유사도 하한) */
  simMin: number;
  /** 코어 밀도 하한 */
  muMin: number;
  /** 산정 근거 */
  basis: {
    /** 산정 방법 식별자·버전 */
    method: string;
    methodVersion: number;
    /** seed 등장 DISTINCT unit 수 */
    seedUnits: number;
    /** 이웃 지명 수 */
    neighborCount: number;
    /** 양의 pairwise 유사도 엣지 수 */
    positiveEdges: number;
  };
}

/** 추천 옵션 */
export interface SuggestOptions {
  scope?: PlaceScope;
  limit?: number;
  /** simMin 산정 분위수(기본 0.6) */
  simQuantile?: number;
  /** muMin 산정 분위수(기본 0.5) */
  muQuantile?: number;
}

const clamp = (x: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, x));

/**
 * 정렬 가정 없이 배열의 분위수를 구한다(내부 정렬). 빈 배열은 undefined.
 * @param values - 수치 배열
 * @param q - 분위수 [0,1]
 * @returns 분위수 값 또는 undefined
 */
export function quantile(values: number[], q: number): number | undefined {
  if (values.length === 0) {
    return undefined;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const idx = clamp(Math.floor(q * (sorted.length - 1)), 0, sorted.length - 1);
  return sorted[idx];
}

/**
 * seed 빈도(등장 unit 수)에서 minCooc 기준값을 로그스케일로 추정한다([1,5] clamp).
 * 희소 seed는 낮게(1~2), 고빈도 seed는 높게(3~5) — 병리(전부노이즈/거대군집) 완화.
 * @param seedUnits - seed 등장 DISTINCT unit 수
 * @returns minCooc 추정값
 */
export function estimateMinCooc(seedUnits: number): number {
  return clamp(Math.max(1, Math.round(Math.log10(seedUnits + 1))), 1, 5);
}

/**
 * seed별 파라미터를 추천한다(추천만, 군집 안 함). seed가 지명으로 없으면 null.
 * @param client - libsql 클라이언트
 * @param seed - 기준 지명 표기(한자)
 * @param options - scope·limit·분위수
 * @returns 추천 파라미터·근거 또는 null
 */
export async function suggestPlaceClusterParams(
  client: Client,
  seed: string,
  options: SuggestOptions = {},
): Promise<SuggestedParams | null> {
  const scope: PlaceScope = options.scope ?? 'article';
  const limit = options.limit ?? 200;
  const simQ = options.simQuantile ?? 0.8; // 제안 70~85%: 약/강 관계 경계
  const muQ = options.muQuantile ?? 0.5;

  // 1) 광역 그래프(minCooc=1)로 seed 빈도 → minCooc 추정
  const wide = await fetchLocalGraph(client, seed, { scope, minCooc: 1, limit });
  const seedEntity = wide?.u[0];
  if (!wide || !seedEntity || wide.u.length < 2) {
    return null;
  }
  const seedUnits = wide.deg.get(seedEntity.entityId) ?? 0;
  const minCooc = estimateMinCooc(seedUnits);

  // 2) 추정 minCooc 그래프에서 유사도 분포 → simMin
  const graph =
    minCooc <= 1
      ? wide
      : ((await fetchLocalGraph(client, seed, { scope, minCooc, limit })) ?? wide);
  const surfaces = graph.u.map((x) => x.surface);
  const sim = jaccardSim(graph);

  const sims: number[] = [];
  for (let i = 0; i < surfaces.length; i += 1) {
    for (let j = i + 1; j < surfaces.length; j += 1) {
      const s = sim(surfaces[i] as string, surfaces[j] as string);
      if (s > 0) {
        sims.push(s);
      }
    }
  }
  const simMin = quantile(sims, simQ) ?? 0.12;

  // 3) simMin에서 밀도 분포 → muMin
  const densities = surfaces.map((p) => {
    let rho = 0;
    for (const q of surfaces) {
      if (q === p) {
        continue;
      }
      const s = sim(p, q);
      if (s >= simMin) {
        rho += s;
      }
    }
    return rho;
  });
  const muMin = quantile(densities, muQ) ?? 0.5;

  const round = (x: number): number => Math.round(x * 1000) / 1000;
  return {
    minCooc,
    simMin: round(simMin),
    muMin: round(muMin),
    basis: {
      method: 'distribution-quantile',
      methodVersion: 1,
      seedUnits,
      neighborCount: surfaces.length - 1,
      positiveEdges: sims.length,
    },
  };
}
