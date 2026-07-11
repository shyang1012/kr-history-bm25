/**
 * @Project: kr-history-bm25
 * @File: search-han.ts
 * @Description: 주 인덱스(한자) BM25 전문검색. 검색어를 unigram phrase로 변환해 정확 인접 매칭한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { Client } from '@libsql/client';
import type { SearchHit } from '../types';
import { buildPhraseQuery } from '../ingest/tokenizer';
import { loadTraditionalForChars, expandSimplifiedToTraditional } from '../reading/simplified';

/** 한자 검색 옵션 */
export interface SearchHanOptions {
  /** 최대 결과 수 */
  limit?: number;
  /** 특정 코퍼스 코드로 제한 */
  corpusCode?: string;
}

/**
 * 한자 원문을 BM25로 검색한다.
 * @param client - libsql 클라이언트
 * @param term - 검색어(한자)
 * @param options - 검색 옵션
 * @returns 관련도 순 검색 결과(한자 없으면 빈 배열)
 */
export async function searchHan(
  client: Client,
  term: string,
  options: SearchHanOptions = {},
): Promise<SearchHit[]> {
  // 간자체 질의 자동 정규화 — 간체가 감지되면 정자 후보로 OR 확장(중국어권 연구자도 그대로 검색). 정자 질의는 불변.
  const revMap = await loadTraditionalForChars(client, [...term]);
  const { candidates } = expandSimplifiedToTraditional(term, revMap);
  const match = candidates
    .map(buildPhraseQuery)
    .filter((m) => m !== '')
    .join(' OR ');
  if (match === '') {
    return [];
  }
  return searchHanByMatch(client, match, options);
}

/**
 * FTS5 MATCH 식을 직접 받아 검색한다(이표기 OR 질의 등 내부 재사용).
 * @param client - libsql 클라이언트
 * @param match - FTS5 MATCH 식
 * @param options - 검색 옵션
 * @returns 검색 결과
 */
export async function searchHanByMatch(
  client: Client,
  match: string,
  options: SearchHanOptions = {},
): Promise<SearchHit[]> {
  const limit = options.limit ?? 20;
  const args: (string | number)[] = [match];
  let corpusFilter = '';
  if (options.corpusCode) {
    corpusFilter = '\n       AND c.code = ?';
    args.push(options.corpusCode);
  }
  args.push(limit);

  const result = await client.execute({
    sql: `
      SELECT p.id                   AS passage_id
           , p.node_id              AS node_id
           , c.code                 AS corpus_code
           , p.text_han             AS text_han
           , bm25(passage_fts_han)  AS score
        FROM passage_fts_han f
        JOIN passage p ON p.id = f.rowid
        JOIN corpus c ON c.id = p.corpus_id
       WHERE passage_fts_han MATCH ?${corpusFilter}
       ORDER BY score
       LIMIT ?
    `,
    args,
  });

  return result.rows.map((row) => ({
    passageId: Number(row.passage_id),
    nodeId: String(row.node_id),
    corpusCode: String(row.corpus_code),
    textHan: String(row.text_han),
    score: Number(row.score),
  }));
}
