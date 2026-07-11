/**
 * @Project: kr-history-bm25
 * @File: build-simplified.mjs
 * @Description: 간자체 매핑 프리빌드 — Unihan kSimplifiedVariant를 char_simplified에 적재한다(정자→간자체 병기 재료).
 *               dist 빌드 이후 실행. KRH_DB로 대상 DB 지정(기본 data/history.sqlite). 원문(정자)은 불변.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { openHistoryDb } from '../dist/index.js';

const DB = process.env.KRH_DB ?? 'data/history.sqlite';
const VARIANTS = process.env.KRH_VARIANTS ?? 'source/unihan/Unihan_Variants.txt';

async function main() {
  const db = await openHistoryDb(DB);
  const stat = await db.ingestSimplified(VARIANTS);
  db.close();
  console.log(`[build:simplified] char_simplified 매핑=${stat.mappings} (${DB})`);
}

main().catch((err) => {
  console.error(`[build:simplified] 오류: ${err.message}`);
  process.exitCode = 1;
});
