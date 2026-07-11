/**
 * @Project: kr-history-bm25
 * @File: cluster.ts
 * @Description: 지명 군집(co-occurrence) 분석. 대상 표기와 선택한 scope(article=기사/paragraph=문단) 단위로
 *               함께 등장하는 개체를 공기 빈도순으로 반환한다. context.md의 "주변 지명·하천·산 군집" 판단을 지지한다.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import type { Client } from '@libsql/client';
import type { ClusterNeighbor } from '../types';

/** 공기 범위: article=기사(node) 단위, paragraph=문단(passage) 단위 */
export type ClusterScope = 'article' | 'paragraph';

/** scope → entity_mention 공기 단위 컬럼(화이트리스트, injection 안전) */
const SCOPE_UNIT_COLUMN: Record<ClusterScope, 'node_id' | 'passage_id'> = {
  article: 'node_id',
  paragraph: 'passage_id',
};

/** 군집 옵션 */
export interface ClusterOptions {
  /** 대상 개체 유형 제한 */
  type?: string;
  /** 이웃 개체 유형 제한(예: 지명만) */
  neighborType?: string;
  /** 최대 이웃 수 */
  limit?: number;
  /** 공기 범위(기본 article=기사). paragraph=문단으로 좁힌다. */
  scope?: ClusterScope;
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
  // scope는 화이트리스트 상수 매핑으로만 SQL 식별자에 반영(사용자 문자열 직접 보간 금지 → injection 안전)
  const unitCol = SCOPE_UNIT_COLUMN[options.scope ?? 'article'];
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
        , target_units AS (
          SELECT DISTINCT ${unitCol} AS unit_id
            FROM entity_mention
           WHERE entity_id IN (SELECT id FROM target)
      )
      SELECT e.type                        AS type
           , e.surface                     AS surface
           , COUNT(DISTINCT m.${unitCol})  AS count
        FROM entity_mention m
        JOIN entity e ON e.id = m.entity_id
       WHERE m.${unitCol} IN (SELECT unit_id FROM target_units)
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
