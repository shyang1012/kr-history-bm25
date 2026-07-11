/**
 * @Project: kr-history-bm25
 * @File: place-clusters.ts
 * @Description: seed 유도 국소 퍼지 지명 군집 — seed 공기 지명(ego-network)을 공기(co-occurrence) Jaccard
 *               유사도로 FDBSCAN 군집한다. 밀도·소속도는 국소 그래프 U 내부에서만 계산(전역 아님).
 *               dedup-first SQL(place_units)로 조인 폭발을 막고, 결과에 간자체 병기·truncated·params를 담는다.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import type { Client } from '@libsql/client';
import type { PlaceClusterResult, FuzzyMember } from '../types';
import { loadSimplifiedMap, toSimplified } from '../reading/simplified';
import { fdbscan } from './fdbscan';

/** 공기 범위: article=node(기사), paragraph=passage(문단) */
export type PlaceScope = 'article' | 'paragraph';

/** scope → 공기 단위 컬럼(화이트리스트, injection-safe) */
const SCOPE_UNIT: Record<PlaceScope, 'node_id' | 'passage_id'> = {
  article: 'node_id',
  paragraph: 'passage_id',
};

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
 * 기본 파라미터 — scripts/fdbscan-sweep.mjs 게이트로 확정(2026-07-11, 동봉 코퍼스).
 * 대표 seed 5종 평균: 군집 ~3.8, 노이즈율 ~0.50, 최대군집비 ~0.38(거대 단일군집 없음, 전 이웃 유지).
 */
const DEFAULTS = { simMin: 0.12, muMin: 0.5, minCooc: 2, limit: 200 };

interface UEntity {
  entityId: number;
  surface: string;
  type: string;
}

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
  const unit = SCOPE_UNIT[scope];
  const params = {
    simMin: options.simMin ?? DEFAULTS.simMin,
    muMin: options.muMin ?? DEFAULTS.muMin,
    minCooc: options.minCooc ?? DEFAULTS.minCooc,
    limit: options.limit ?? DEFAULTS.limit,
  };
  const empty: PlaceClusterResult = {
    seed,
    scope,
    params,
    truncated: false,
    clusters: [],
    noise: [],
  };

  // dedup-first: 같은 (unit, 지명 entity) 중복 mention 제거(조인 폭발 방지)
  const placeUnits = `SELECT DISTINCT m.${unit} AS unit, m.entity_id
                        FROM entity_mention m
                        JOIN entity e ON e.id = m.entity_id AND e.type = '지명'`;

  // seed entity id(지명)
  const seedRow = await client.execute({
    sql: `SELECT id FROM entity WHERE surface = ? AND type = '지명'`,
    args: [seed],
  });
  const seedIdRow = seedRow.rows[0];
  if (!seedIdRow) {
    return empty;
  }
  const seedId = Number(seedIdRow.id);

  // U 이웃: seed와 공기하는 지명(cooc DESC, entity_id ASC, limit 절단)
  const nbrRes = await client.execute({
    sql: `
      WITH place_units AS (${placeUnits})
         , seed_units AS (SELECT DISTINCT unit FROM place_units WHERE entity_id = ?)
      SELECT pu.entity_id AS entity_id
           , e.surface    AS surface
           , e.type       AS type
           , COUNT(DISTINCT pu.unit) AS cooc
        FROM place_units pu
        JOIN entity e ON e.id = pu.entity_id
       WHERE pu.unit IN (SELECT unit FROM seed_units)
         AND pu.entity_id <> ?
       GROUP BY pu.entity_id
      HAVING cooc >= ?
       ORDER BY cooc DESC, pu.entity_id ASC
       LIMIT ?`,
    args: [seedId, seedId, params.minCooc, params.limit],
  });
  const truncated = nbrRes.rows.length >= params.limit;

  // U = seed + 이웃. seed는 type='지명'으로 조회됨.
  const u: UEntity[] = [{ entityId: seedId, surface: seed, type: '지명' }];
  for (const r of nbrRes.rows) {
    u.push({ entityId: Number(r.entity_id), surface: String(r.surface), type: String(r.type) });
  }
  if (u.length < 2) {
    return { ...empty, truncated };
  }

  const ids = u.map((x) => x.entityId);
  const placeholders = ids.map(() => '?').join(', ');

  // deg(X) = X가 등장한 DISTINCT unit 수
  const degRes = await client.execute({
    sql: `WITH place_units AS (${placeUnits})
          SELECT entity_id, COUNT(*) AS deg FROM place_units
           WHERE entity_id IN (${placeholders}) GROUP BY entity_id`,
    args: ids,
  });
  const deg = new Map<number, number>();
  for (const r of degRes.rows) {
    deg.set(Number(r.entity_id), Number(r.deg));
  }

  // U 내부 pairwise 공기(상삼각, cooc>=minCooc)
  const pairRes = await client.execute({
    sql: `
      WITH place_units AS (${placeUnits})
      SELECT a.entity_id AS a, b.entity_id AS b, COUNT(DISTINCT a.unit) AS cooc
        FROM place_units a
        JOIN place_units b ON b.unit = a.unit AND b.entity_id < a.entity_id
       WHERE a.entity_id IN (${placeholders}) AND b.entity_id IN (${placeholders})
       GROUP BY a.entity_id, b.entity_id
      HAVING cooc >= ?`,
    args: [...ids, ...ids, params.minCooc],
  });
  const cooc = new Map<string, number>();
  for (const r of pairRes.rows) {
    const a = Number(r.a);
    const b = Number(r.b);
    cooc.set(`${Math.min(a, b)}|${Math.max(a, b)}`, Number(r.cooc));
  }

  // surface ↔ entityId (지명 surface는 type 내 unique)
  const idOf = new Map<string, number>(u.map((x) => [x.surface, x.entityId]));
  const infoOf = new Map<string, UEntity>(u.map((x) => [x.surface, x]));

  // Jaccard 유사도: cooc / (deg(a)+deg(b)-cooc)
  const sim = (sa: string, sb: string): number => {
    const ia = idOf.get(sa);
    const ib = idOf.get(sb);
    if (ia === undefined || ib === undefined) {
      return 0;
    }
    const c = cooc.get(`${Math.min(ia, ib)}|${Math.max(ia, ib)}`) ?? 0;
    if (c === 0) {
      return 0;
    }
    const denom = (deg.get(ia) ?? 0) + (deg.get(ib) ?? 0) - c;
    return denom > 0 ? c / denom : 0;
  };

  const surfaces = u.map((x) => x.surface);
  const result = fdbscan(surfaces, sim, { simMin: params.simMin, muMin: params.muMin });

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

  return { seed, scope, params, truncated, clusters, noise: [...result.noise].sort() };
}
