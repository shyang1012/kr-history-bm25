/**
 * @Project: kr-history-bm25
 * @File: build-corpus.mjs
 * @Description: 유지보수용 — source/의 사서 5종을 data/history.sqlite로 ingest한 뒤 gzip(data/history.sqlite.gz)으로 동봉본을 만든다.
 *               dist 빌드 이후 실행한다(npm run build:corpus). source/가 있어야 한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import {
  readdirSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  createReadStream,
  createWriteStream,
} from 'node:fs';
import { join } from 'node:path';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { openHistoryDb, createDbConnection } from '../dist/index.js';

const SOURCE_DIR = 'source';
const DATA_DIR = 'data';
const DB_PATH = join(DATA_DIR, 'history.sqlite');
const GZ_PATH = `${DB_PATH}.gz`;

/** MB 문자열 */
function mb(bytes) {
  return `${(bytes / 1048576).toFixed(1)} MB`;
}

async function main() {
  if (!existsSync(SOURCE_DIR)) {
    throw new Error(`source/ 가 없습니다: ${SOURCE_DIR}`);
  }
  mkdirSync(DATA_DIR, { recursive: true });
  for (const suffix of ['', '-shm', '-wal']) {
    rmSync(`${DB_PATH}${suffix}`, { force: true });
  }

  const db = await openHistoryDb(DB_PATH);
  const dirs = readdirSync(SOURCE_DIR, { withFileTypes: true }).filter((d) => d.isDirectory());
  for (const d of dirs) {
    const stats = await db.ingest({ dir: join(SOURCE_DIR, d.name) });
    console.log(
      `[build:corpus] ${stats.name}(${stats.code}) — passages=${stats.passages} mentions=${stats.mentions}`,
    );
  }
  db.close();

  // VACUUM으로 조각모음 → 크기 축소 + gzip 효율 향상
  const { client } = createDbConnection(DB_PATH);
  await client.execute('VACUUM');
  client.close();

  await pipeline(createReadStream(DB_PATH), createGzip({ level: 9 }), createWriteStream(GZ_PATH));
  console.log(
    `[build:corpus] ${DB_PATH} ${mb(statSync(DB_PATH).size)} → ${GZ_PATH} ${mb(statSync(GZ_PATH).size)}`,
  );
}

main().catch((err) => {
  console.error(`[build:corpus] 오류: ${err.message}`);
  process.exitCode = 1;
});
