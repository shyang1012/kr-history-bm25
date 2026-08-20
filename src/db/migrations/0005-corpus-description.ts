/**
 * @Project: kr-history-bm25
 * @File: 0005-corpus-description.ts
 * @Description: 코퍼스 자기설명 마이그레이션 — corpus.description 컬럼 추가 + 레지스트리 backfill.
 *               🔴 SQL은 corpus-registry(단일 소스)에서 생성한다(손유지 문자열 드리프트 차단, krh-i2o).
 *               기존 동봉본은 openBundledDb→HistoryDb.open 경로에서 이 마이그레이션을 받아
 *               gz 재생성 없이 설명을 갖는다. 이미 설명이 있는 행은 덮어쓰지 않는다.
 * @Author: shyang
 * @LastModified: 2026-08-21
 */
import { CORPUS_REGISTRY, type CorpusMeta } from '../../corpus/corpus-registry';

/** 마이그레이션 버전 식별자 */
export const VERSION = '0005-corpus-description';

/** SQL 문자열 리터럴로 인용한다(작은따옴표 이스케이프) */
function quote(text: string): string {
  return `'${text.replace(/'/g, "''")}'`;
}

/** 레지스트리 1종 → backfill UPDATE 문 */
function backfill([code, meta]: [string, CorpusMeta]): string {
  return `UPDATE corpus
   SET description = ${quote(meta.description)}
 WHERE code = ${quote(code)}
   AND (description IS NULL OR TRIM(description) = '');`;
}

/**
 * corpus.description 추가 + 동봉 코퍼스 5종 설명 backfill.
 * 신규 DB에서는 corpus 행이 없어 UPDATE가 0행이며, ingest가 기록한다(ingest-corpus.upsertCorpus).
 */
export const SQL = `
ALTER TABLE corpus ADD COLUMN description TEXT;

${Object.entries(CORPUS_REGISTRY).map(backfill).join('\n\n')}
`;
