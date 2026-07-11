/**
 * @Project: kr-history-bm25
 * @File: 0003-simplified.ts
 * @Description: 간자체(簡體) 매핑 마이그레이션 — char_simplified(정자→간자체 1:1). Unihan kSimplifiedVariant 원천.
 *               지명 등 표기를 간자체로 병기해 연구자가 구글맵·바이두맵에 바로 붙여 현존·위치를 확인하게 한다(krh-cgh MVP).
 * @Author: shyang
 * @LastModified: 2026-07-11
 */

/** 마이그레이션 버전 식별자 */
export const VERSION = '0003-simplified';

/** 간자체 매핑 DDL. char=정자(번체) 1자를 PK로 간자체 1자를 대응한다. */
export const SQL = `
CREATE TABLE IF NOT EXISTS char_simplified (
    char        TEXT PRIMARY KEY
  , simplified  TEXT NOT NULL
  , source      TEXT NOT NULL
);
`;
