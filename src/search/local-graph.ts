/**
 * @Project: kr-history-bm25
 * @File: local-graph.ts
 * @Description: seed 유도 국소 공기 그래프 U 구축(place_units dedup-first SQL) + Jaccard 유사도. placeClusters와
 *               파라미터 자동 산정(suggest/auto)이 공유한다. scope는 화이트리스트로만 SQL 식별자에 반영(injection-safe).
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import type { Client } from '@libsql/client';

/** 공기 범위: article=node(기사), paragraph=passage(문단) */
export type PlaceScope = 'article' | 'paragraph';

/** scope → 공기 단위 컬럼(화이트리스트, injection-safe) */
export const SCOPE_UNIT: Record<PlaceScope, 'node_id' | 'passage_id'> = {
  article: 'node_id',
  paragraph: 'passage_id',
};

/** U의 지명 개체 1건 */
export interface UEntity {
  entityId: number;
  surface: string;
  type: string;
}

/** seed 유도 국소 공기 그래프 */
export interface LocalGraph {
  /** seed + 이웃 지명(seed가 index 0) */
  u: UEntity[];
  /** entity_id → 등장 DISTINCT unit 수 */
  deg: Map<number, number>;
  /** "minId|maxId" → 공기 unit 수(cooc≥minCooc) */
  cooc: Map<string, number>;
  /** seed 이웃이 limit로 절단됐는가 */
  truncated: boolean;
}

/**
 * seed 지명의 국소 공기 그래프를 조회한다. seed가 지명 개체로 없으면 null.
 * @param client - libsql 클라이언트
 * @param seed - 기준 지명 표기(한자)
 * @param opts - scope·minCooc·limit
 * @returns 국소 그래프(u·deg·cooc·truncated) 또는 null
 */
export async function fetchLocalGraph(
  client: Client,
  seed: string,
  opts: { scope: PlaceScope; minCooc: number; limit: number },
): Promise<LocalGraph | null> {
  const unit = SCOPE_UNIT[opts.scope];
  const placeUnits = `SELECT DISTINCT m.${unit} AS unit, m.entity_id
                        FROM entity_mention m
                        JOIN entity e ON e.id = m.entity_id AND e.type = '지명'`;

  const seedRow = await client.execute({
    sql: `SELECT id FROM entity WHERE surface = ? AND type = '지명'`,
    args: [seed],
  });
  const seedIdRow = seedRow.rows[0];
  if (!seedIdRow) {
    return null;
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
    args: [seedId, seedId, opts.minCooc, opts.limit],
  });
  const truncated = nbrRes.rows.length >= opts.limit;

  const u: UEntity[] = [{ entityId: seedId, surface: seed, type: '지명' }];
  for (const r of nbrRes.rows) {
    u.push({ entityId: Number(r.entity_id), surface: String(r.surface), type: String(r.type) });
  }

  const deg = new Map<number, number>();
  const cooc = new Map<string, number>();
  if (u.length < 2) {
    return { u, deg, cooc, truncated };
  }

  const ids = u.map((x) => x.entityId);
  const placeholders = ids.map(() => '?').join(', ');

  const degRes = await client.execute({
    sql: `WITH place_units AS (${placeUnits})
          SELECT entity_id, COUNT(*) AS deg FROM place_units
           WHERE entity_id IN (${placeholders}) GROUP BY entity_id`,
    args: ids,
  });
  for (const r of degRes.rows) {
    deg.set(Number(r.entity_id), Number(r.deg));
  }

  const pairRes = await client.execute({
    sql: `
      WITH place_units AS (${placeUnits})
      SELECT a.entity_id AS a, b.entity_id AS b, COUNT(DISTINCT a.unit) AS cooc
        FROM place_units a
        JOIN place_units b ON b.unit = a.unit AND b.entity_id < a.entity_id
       WHERE a.entity_id IN (${placeholders}) AND b.entity_id IN (${placeholders})
       GROUP BY a.entity_id, b.entity_id
      HAVING cooc >= ?`,
    args: [...ids, ...ids, opts.minCooc],
  });
  for (const r of pairRes.rows) {
    const a = Number(r.a);
    const b = Number(r.b);
    cooc.set(`${Math.min(a, b)}|${Math.max(a, b)}`, Number(r.cooc));
  }

  return { u, deg, cooc, truncated };
}

/**
 * 국소 그래프의 Jaccard 유사도 함수를 만든다(surface 기준). cooc/(deg(a)+deg(b)-cooc), 미연결=0.
 * @param graph - fetchLocalGraph 결과
 * @returns sim(a, b) ∈ [0,1]
 */
export function jaccardSim(graph: LocalGraph): (a: string, b: string) => number {
  const idOf = new Map<string, number>(graph.u.map((x) => [x.surface, x.entityId]));
  return (sa, sb) => {
    const ia = idOf.get(sa);
    const ib = idOf.get(sb);
    if (ia === undefined || ib === undefined) {
      return 0;
    }
    const c = graph.cooc.get(`${Math.min(ia, ib)}|${Math.max(ia, ib)}`) ?? 0;
    if (c === 0) {
      return 0;
    }
    const denom = (graph.deg.get(ia) ?? 0) + (graph.deg.get(ib) ?? 0) - c;
    return denom > 0 ? c / denom : 0;
  };
}
