/**
 * @Project: kr-history-bm25
 * @File: cluster.ts
 * @Description: 지명 군집(co-occurrence) 분석. 대상 표기와 같은 기사(node)에 함께 등장하는 개체를 공기 빈도순으로 반환한다.
 *               context.md의 "주변 지명·하천·산 군집" 판단을 지지한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { Client } from '@libsql/client';
import type { ClusterNeighbor } from '../types';

/** 군집 옵션 */
export interface ClusterOptions {
  /** 대상 개체 유형 제한 */
  type?: string;
  /** 이웃 개체 유형 제한(예: 지명만) */
  neighborType?: string;
  /** 최대 이웃 수 */
  limit?: number;
}

/**
 * 대상 표기와 공기(共起)하는 개체를 조회한다.
 * @param client - libsql 클라이언트
 * @param surface - 대상 표기(한자)
 * @param options - 군집 옵션
 * @returns 공기 빈도 내림차순 이웃 목록
 */
export async function cluster(
  client: Client,
  surface: string,
  options: ClusterOptions = {},
): Promise<ClusterNeighbor[]> {
  const limit = options.limit ?? 50;
  const args: (string | number)[] = [surface];
  let targetTypeFilter = '';
  if (options.type) {
    targetTypeFilter = '\n           AND type = ?';
    args.push(options.type);
  }
  let neighborTypeFilter = '';
  if (options.neighborType) {
    neighborTypeFilter = '\n       AND e.type = ?';
    args.push(options.neighborType);
  }
  args.push(limit);

  const result = await client.execute({
    sql: `
      WITH target AS (
          SELECT id
            FROM entity
           WHERE surface = ?${targetTypeFilter}
      )
        , target_nodes AS (
          SELECT DISTINCT node_id
            FROM entity_mention
           WHERE entity_id IN (SELECT id FROM target)
      )
      SELECT e.type                     AS type
           , e.surface                  AS surface
           , COUNT(DISTINCT m.node_id)  AS count
        FROM entity_mention m
        JOIN entity e ON e.id = m.entity_id
       WHERE m.node_id IN (SELECT node_id FROM target_nodes)
         AND m.entity_id NOT IN (SELECT id FROM target)${neighborTypeFilter}
       GROUP BY e.id
       ORDER BY count DESC, e.surface
       LIMIT ?
    `,
    args,
  });

  return result.rows.map((row) => ({
    type: String(row.type),
    surface: String(row.surface),
    count: Number(row.count),
  }));
}
