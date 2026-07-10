/**
 * @Project: kr-history-bm25
 * @File: search-ko.ts
 * @Description: 보조 인덱스(LLM 직역) BM25 전문검색. 채택된 직역만 색인 대상이며 원문과 함께 반환한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { Client } from '@libsql/client';
import type { KoSearchHit } from '../types';
import { buildKoPhraseQuery } from '../ingest/tokenizer';

/** 직역 검색 옵션 */
export interface SearchKoOptions {
  /** 최대 결과 수 */
  limit?: number;
}

/**
 * 직역(보조 인덱스)을 BM25로 검색한다.
 * @param client - libsql 클라이언트
 * @param term - 검색어(한국어)
 * @param options - 검색 옵션
 * @returns 관련도 순 검색 결과(원문·직역 동반)
 */
export async function searchKo(
  client: Client,
  term: string,
  options: SearchKoOptions = {},
): Promise<KoSearchHit[]> {
  const match = buildKoPhraseQuery(term);
  if (match === '') {
    return [];
  }
  const limit = options.limit ?? 20;

  const result = await client.execute({
    sql: `
      SELECT k.passage_id           AS passage_id
           , p.node_id              AS node_id
           , c.code                 AS corpus_code
           , p.text_han             AS text_han
           , t.text                 AS ko_text
           , bm25(passage_fts_ko)   AS score
        FROM passage_fts_ko k
        JOIN passage p ON p.id = k.passage_id
        JOIN corpus c ON c.id = p.corpus_id
        LEFT JOIN translation t ON t.passage_id = p.id AND t.adopted = 1
       WHERE passage_fts_ko MATCH ?
       ORDER BY score
       LIMIT ?
    `,
    args: [match, limit],
  });

  return result.rows.map((row) => ({
    passageId: Number(row.passage_id),
    nodeId: String(row.node_id),
    corpusCode: String(row.corpus_code),
    textHan: String(row.text_han),
    koText: row.ko_text === null ? null : String(row.ko_text),
    score: Number(row.score),
  }));
}
