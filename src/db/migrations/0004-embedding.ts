/**
 * @Project: kr-history-bm25
 * @File: 0004-embedding.ts
 * @Description: 의미 벡터 마이그레이션 — passage_embedding(passage_id·kind별 int8 정규화 벡터 BLOB) + embedding_meta
 *               (모델·차원·양자화 1행). e5-small(384d) sg/sy 원문·직역 임베딩을 동봉 DB에 굽는다(krh-cvh Phase 1).
 *               저장은 int8 양자화(round(v*127)), 로드 시 /127 dequant 후 JS cosine. libsql 벡터함수 미사용.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */

/** 마이그레이션 버전 식별자 */
export const VERSION = '0004-embedding';

/**
 * 벡터 저장 DDL.
 * - passage_embedding: (passage_id, kind) 복합 PK. kind='han'(원문)|'ko'(직역). vec=int8[dim] BLOB.
 * - embedding_meta: 단일행(id=1) — 로드 시 model·dim 호환 검증용(불일치 시 벡터 arm 비활성).
 */
export const SQL = `
CREATE TABLE IF NOT EXISTS passage_embedding (
    passage_id  INTEGER NOT NULL
  , kind        TEXT    NOT NULL CHECK (kind IN ('han', 'ko'))
  , vec         BLOB    NOT NULL
  , PRIMARY KEY (passage_id, kind)
);

CREATE TABLE IF NOT EXISTS embedding_meta (
    id        INTEGER PRIMARY KEY CHECK (id = 1)
  , model     TEXT    NOT NULL
  , dim       INTEGER NOT NULL
  , quant     TEXT    NOT NULL
  , built_at  TEXT    NOT NULL
);
`;
