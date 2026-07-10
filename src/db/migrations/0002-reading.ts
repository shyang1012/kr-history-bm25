/**
 * @Project: kr-history-bm25
 * @File: 0002-reading.ts
 * @Description: 독음 사전 마이그레이션 — char_reading(글자 독음·Unihan kHangul 원천) +
 *               entity_reading(개체 독음·원음 original/관용 conventional 이중 레이어).
 *               translation 테이블의 status/adopted 구조 답습. reading_type별 adopted 1개는
 *               partial unique index(WHERE adopted=1)로 DB 강제(재실행 멱등).
 * @Author: shyang
 * @LastModified: 2026-07-10
 */

/** 마이그레이션 버전 식별자 */
export const VERSION = '0002-reading';

/**
 * 독음 사전 DDL. executeMultiple로 일괄 적용한다.
 * 관계형 컬럼 정의는 schema.ts(charReading·entityReading)와 1:1 대응한다.
 * partial unique index는 schema.ts(Drizzle)가 표현하지 않으므로 이 마이그레이션이 단독 관리한다.
 */
export const SQL = `
CREATE TABLE IF NOT EXISTS char_reading (
    id       INTEGER PRIMARY KEY AUTOINCREMENT
  , char     TEXT NOT NULL
  , reading  TEXT NOT NULL
  , source   TEXT NOT NULL
  , seq      INTEGER NOT NULL DEFAULT 0
  , is_dueum INTEGER NOT NULL DEFAULT 0
);
CREATE UNIQUE INDEX IF NOT EXISTS char_reading_char_reading_uq ON char_reading (char, reading);
CREATE INDEX IF NOT EXISTS char_reading_char_idx ON char_reading (char);

CREATE TABLE IF NOT EXISTS entity_reading (
    id           INTEGER PRIMARY KEY AUTOINCREMENT
  , entity_id    INTEGER NOT NULL
  , reading      TEXT
  , reading_type TEXT NOT NULL
  , source       TEXT NOT NULL
  , confidence   INTEGER NOT NULL DEFAULT 0
  , status       TEXT NOT NULL DEFAULT 'draft'
  , adopted      INTEGER NOT NULL DEFAULT 0
  , created_at   TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_reading_uq ON entity_reading (entity_id, reading_type, source);
CREATE INDEX IF NOT EXISTS entity_reading_status_idx ON entity_reading (status);
-- 타입당 채택 1개 불변식(재실행 멱등): 재채택 시 기존 adopted=0 해제 후 재지정
CREATE UNIQUE INDEX IF NOT EXISTS entity_reading_adopted_uq ON entity_reading (entity_id, reading_type) WHERE adopted = 1;
`;
