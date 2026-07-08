/**
 * @Project: kr-history-bm25
 * @File: lookup-place.ts
 * @Description: 구조화 색인 조회. 특정 표기(한자, 엄격 구분)가 등장하는 모든 위치를 사서·권·기사 메타와 함께 반환한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { Client } from '@libsql/client';
import type { PlaceOccurrence } from '../types';

/** 구조화 조회 옵션 */
export interface LookupOptions {
  /** 개체 유형 제한(지명/이름/국명 등). 미지정 시 모든 유형 */
  type?: string;
  /** 최대 결과 수 */
  limit?: number;
}

/**
 * 색인 표기의 출현 위치를 조회한다.
 * @param client - libsql 클라이언트
 * @param surface - 표기(한자)
 * @param options - 조회 옵션
 * @returns 출현 위치 목록
 */
export async function lookupPlace(
  client: Client,
  surface: string,
  options: LookupOptions = {},
): Promise<PlaceOccurrence[]> {
  const limit = options.limit ?? 100;
  const args: (string | number)[] = [surface];
  let typeFilter = '';
  if (options.type) {
    typeFilter = '\n       AND e.type = ?';
    args.push(options.type);
  }
  args.push(limit);

  const result = await client.execute({
    sql: `
      SELECT m.passage_id  AS passage_id
           , m.node_id     AS node_id
           , c.code        AS corpus_code
           , n.title       AS node_title
           , n.path        AS path
        FROM entity_mention m
        JOIN entity e ON e.id = m.entity_id
        JOIN node n ON n.id = m.node_id
        JOIN corpus c ON c.id = m.corpus_id
       WHERE e.surface = ?${typeFilter}
       ORDER BY c.code, n.path, m.char_offset
       LIMIT ?
    `,
    args,
  });

  return result.rows.map((row) => ({
    passageId: Number(row.passage_id),
    nodeId: String(row.node_id),
    corpusCode: String(row.corpus_code),
    nodeTitle: row.node_title === null ? null : String(row.node_title),
    path: String(row.path),
  }));
}
