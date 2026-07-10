/**
 * @Project: kr-history-bm25
 * @File: build-readings.mjs
 * @Description: 독음 사전 프리빌드 — Unihan ingest → 사전 구축(원음 확정 → 관용 도출).
 *               dist 빌드 산출물을 사용한다. KRH_DB로 대상 DB를 지정한다(기본 data/history.sqlite).
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { openHistoryDb } from '../dist/index.js';

const DB = process.env.KRH_DB ?? 'data/history.sqlite';
const UNIHAN = process.env.KRH_UNIHAN ?? 'source/unihan/Unihan_Readings.txt';
const SEEDS = process.env.KRH_SEEDS ?? 'data/reading-seeds.json';
const DICT_DIR = process.env.KRH_DICT_DIR ?? 'source/전체 내려받기_표준국어대사전_JSON_20260706';

async function main() {
  const db = await openHistoryDb(DB);

  const uni = await db.ingestUnihan(UNIHAN);
  console.log(`[unihan] chars=${uni.chars} readings=${uni.readings}`);

  let dictPaths;
  try {
    dictPaths = readdirSync(DICT_DIR)
      .filter((f) => f.endsWith('.json'))
      .map((f) => join(DICT_DIR, f));
    console.log(`[dict] ${dictPaths.length} JSON 파일`);
  } catch {
    console.log('[dict] 표준국어대사전 디렉터리 없음 — dict 없이 진행');
    dictPaths = undefined;
  }

  const stats = await db.buildReadings({ seedsPath: SEEDS, dictPaths });
  console.log(
    `[build] entities=${stats.entities} original(confirmed)=${stats.originalConfirmed} ` +
      `draft=${stats.originalDraft} conventional=${stats.conventionalAdopted} ` +
      `has_variant=${stats.variants}`,
  );
  console.log(
    `[review] LLM 검수 필요 char=${stats.reviewChars.length}` +
      (stats.reviewChars.length ? ` (예: ${stats.reviewChars.slice(0, 20).join(' ')})` : ''),
  );

  db.close();
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
