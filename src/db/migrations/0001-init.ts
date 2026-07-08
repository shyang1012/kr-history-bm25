/**
 * @Project: kr-history-bm25
 * @File: 0001-init.ts
 * @Description: 초기 스키마 마이그레이션 — 관계형 테이블 + FTS5 가상테이블(주=한자 / 보조=직역) + 동기화 트리거.
 *               hand-written SQL (drizzle-kit 미사용). 예약어 대문자·snake_case 식별자 (CW-AP-D03 §11).
 * @Author: shyang
 * @LastModified: 2026-07-09
 */

/** 마이그레이션 버전 식별자 */
export const VERSION = '0001-init';

/**
 * 초기 스키마 DDL. executeMultiple로 일괄 적용한다.
 * 관계형 컬럼 정의는 schema.ts(Drizzle) 정의와 1:1 대응한다.
 */
export const SQL = `
CREATE TABLE IF NOT EXISTS corpus (
    id          INTEGER PRIMARY KEY AUTOINCREMENT
  , code        TEXT NOT NULL UNIQUE
  , name        TEXT NOT NULL
  , source_dir  TEXT NOT NULL
  , dtd_version TEXT
  , ingested_at TEXT
);

CREATE TABLE IF NOT EXISTS node (
    id          TEXT PRIMARY KEY
  , corpus_id   INTEGER NOT NULL
  , parent_id   TEXT
  , level_no    INTEGER NOT NULL
  , type        TEXT
  , value       TEXT
  , wangmyeong  TEXT
  , reign_year  TEXT
  , title       TEXT
  , path        TEXT NOT NULL
  , seq         INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS node_corpus_idx ON node (corpus_id);
CREATE INDEX IF NOT EXISTS node_parent_idx ON node (parent_id);

CREATE TABLE IF NOT EXISTS passage (
    id          INTEGER PRIMARY KEY AUTOINCREMENT
  , corpus_id   INTEGER NOT NULL
  , node_id     TEXT NOT NULL
  , seq         INTEGER NOT NULL
  , text_han    TEXT NOT NULL
  , han_indexed TEXT NOT NULL
  , char_count  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS passage_node_idx ON passage (node_id);
CREATE INDEX IF NOT EXISTS passage_corpus_idx ON passage (corpus_id);

CREATE TABLE IF NOT EXISTS entity (
    id      INTEGER PRIMARY KEY AUTOINCREMENT
  , type    TEXT NOT NULL
  , surface TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_type_surface_uq ON entity (type, surface);

CREATE TABLE IF NOT EXISTS entity_mention (
    id          INTEGER PRIMARY KEY AUTOINCREMENT
  , entity_id   INTEGER NOT NULL
  , passage_id  INTEGER NOT NULL
  , node_id     TEXT NOT NULL
  , corpus_id   INTEGER NOT NULL
  , char_offset INTEGER NOT NULL
  , attrs       TEXT
);
CREATE INDEX IF NOT EXISTS mention_entity_idx ON entity_mention (entity_id);
CREATE INDEX IF NOT EXISTS mention_node_idx ON entity_mention (node_id);
CREATE INDEX IF NOT EXISTS mention_passage_idx ON entity_mention (passage_id);

CREATE TABLE IF NOT EXISTS annotation (
    id         INTEGER PRIMARY KEY AUTOINCREMENT
  , passage_id INTEGER NOT NULL
  , type       TEXT
  , text       TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS annotation_passage_idx ON annotation (passage_id);

CREATE TABLE IF NOT EXISTS variant_group (
    id     INTEGER PRIMARY KEY AUTOINCREMENT
  , note   TEXT
  , source TEXT
);

CREATE TABLE IF NOT EXISTS variant_member (
    group_id  INTEGER NOT NULL
  , entity_id INTEGER NOT NULL
  , PRIMARY KEY (group_id, entity_id)
);
CREATE INDEX IF NOT EXISTS variant_member_entity_idx ON variant_member (entity_id);

CREATE TABLE IF NOT EXISTS translation (
    id         INTEGER PRIMARY KEY AUTOINCREMENT
  , passage_id INTEGER NOT NULL
  , provider   TEXT NOT NULL
  , model      TEXT
  , text       TEXT
  , status     TEXT NOT NULL DEFAULT 'pending'
  , adopted    INTEGER NOT NULL DEFAULT 0
  , created_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS translation_passage_provider_uq ON translation (passage_id, provider);
CREATE INDEX IF NOT EXISTS translation_status_idx ON translation (status);

-- 주 인덱스: 한자 unigram FTS5 (external content = passage)
CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts_han USING fts5 (
    han_indexed
  , content='passage'
  , content_rowid='id'
  , tokenize='unicode61'
);

CREATE TRIGGER IF NOT EXISTS passage_ai AFTER INSERT ON passage BEGIN
  INSERT INTO passage_fts_han (rowid, han_indexed) VALUES (new.id, new.han_indexed);
END;
CREATE TRIGGER IF NOT EXISTS passage_ad AFTER DELETE ON passage BEGIN
  INSERT INTO passage_fts_han (passage_fts_han, rowid, han_indexed) VALUES ('delete', old.id, old.han_indexed);
END;
CREATE TRIGGER IF NOT EXISTS passage_au AFTER UPDATE ON passage BEGIN
  INSERT INTO passage_fts_han (passage_fts_han, rowid, han_indexed) VALUES ('delete', old.id, old.han_indexed);
  INSERT INTO passage_fts_han (rowid, han_indexed) VALUES (new.id, new.han_indexed);
END;

-- 보조 인덱스: 직역 FTS5 (standalone, 채택된 직역만 명시적으로 적재)
CREATE VIRTUAL TABLE IF NOT EXISTS passage_fts_ko USING fts5 (
    ko_text
  , passage_id UNINDEXED
  , tokenize='unicode61'
);
`;
