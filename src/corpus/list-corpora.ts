/**
 * @Project: kr-history-bm25
 * @File: list-corpora.ts
 * @Description: 코퍼스 카탈로그 조회 — 「이 서버가 무엇을 담고 있는가」에 답하는 유일한 경로.
 *               설명은 DB(corpus.description) 우선, 비었으면 레지스트리 폴백(구 DB 방어).
 *               미등재 코퍼스(사용자 자체 ingest)는 null로 두어 거짓 설명을 지어내지 않는다.
 * @Author: shyang
 * @LastModified: 2026-08-21
 */
import type { Client } from '@libsql/client';
import { corpusOrder, registryDescription } from './corpus-registry';

/** 코퍼스 1종의 카탈로그 정보 */
export interface CorpusInfo {
  /** 코퍼스 코드 · 검색 도구 corpusCode 인자 값 */
  code: string;
  /** 사서명 */
  name: string;
  /** 이 코퍼스가 무엇인가 · 미등재 코퍼스는 null */
  description: string | null;
  /** 수록 본문(passage) 수 */
  passageCount: number;
  /** 직역(보조 인덱스) 채택 건수 · search_ko·search_hybrid 유효 범위 */
  translatedCount: number;
  /** ingest 완료 시각 · ISO8601 */
  ingestedAt: string | null;
}

/** 빈 문자열을 null로 정규화한다 */
function nullIfBlank(value: unknown): string | null {
  const text = value === null || value === undefined ? '' : String(value);
  return text.trim() === '' ? null : text;
}

/**
 * 코퍼스 목록과 건수를 조회한다.
 * @param client - libsql 클라이언트
 * @returns 레지스트리 순서(사서 연대순)로 정렬된 카탈로그. 미등재 코드는 뒤에 코드순으로 붙는다
 */
export async function listCorpora(client: Client): Promise<CorpusInfo[]> {
  const corpora = await client.execute(`
    SELECT id
         , code
         , name
         , description
         , ingested_at
      FROM corpus
  `);

  const passages = await client.execute(`
    SELECT corpus_id
         , COUNT(*) AS n
      FROM passage
     GROUP BY corpus_id
  `);
  const passageCounts = new Map<number, number>();
  for (const row of passages.rows) {
    passageCounts.set(Number(row.corpus_id), Number(row.n));
  }

  const translated = await client.execute(`
    SELECT p.corpus_id AS corpus_id
         , COUNT(*)    AS n
      FROM translation t
      JOIN passage p ON p.id = t.passage_id
     WHERE t.status = 'done'
       AND t.adopted = 1
     GROUP BY p.corpus_id
  `);
  const translatedCounts = new Map<number, number>();
  for (const row of translated.rows) {
    translatedCounts.set(Number(row.corpus_id), Number(row.n));
  }

  return corpora.rows
    .map((row) => {
      const id = Number(row.id);
      const code = String(row.code);
      return {
        code,
        name: String(row.name),
        description: nullIfBlank(row.description) ?? registryDescription(code),
        passageCount: passageCounts.get(id) ?? 0,
        translatedCount: translatedCounts.get(id) ?? 0,
        ingestedAt: nullIfBlank(row.ingested_at),
      };
    })
    .sort((a, b) => corpusOrder(a.code) - corpusOrder(b.code) || a.code.localeCompare(b.code));
}
