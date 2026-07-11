/**
 * @Project: kr-history-bm25
 * @File: bake-readings-gz.mjs
 * @Description: 독음이 반영된 data/history.sqlite를 그대로 VACUUM + gzip해 동봉본(data/history.sqlite.gz)을 갱신한다.
 *               🔴 build-corpus.mjs와 달리 source/ 재-ingest를 하지 않는다(독음 데이터 보존). 검수 파이프라인
 *               (krh-4lr) 반영 후 배포 산출물만 재압축하는 용도(krh-evf).
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { existsSync, statSync, createReadStream, createWriteStream } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { createDbConnection } from '../dist/index.js';

const DB_PATH = 'data/history.sqlite';
const GZ_PATH = `${DB_PATH}.gz`;

const mb = (b) => `${(b / 1048576).toFixed(1)} MB`;

async function main() {
  if (!existsSync(DB_PATH)) {
    throw new Error(`${DB_PATH} 가 없습니다. 먼저 코퍼스+독음을 구축하세요.`);
  }
  // 독음 반영 여부 사전 확인(빈 껍데기 재압축 방지)
  const { client } = createDbConnection(DB_PATH);
  const er = (await client.execute('SELECT COUNT(*) n FROM entity_reading')).rows[0].n;
  if (Number(er) === 0) {
    client.close();
    throw new Error(`entity_reading 0행 — 독음 미반영 DB. 베이킹 중단(krh-4lr 먼저).`);
  }
  await client.execute('VACUUM');
  client.close();

  await pipeline(createReadStream(DB_PATH), createGzip({ level: 9 }), createWriteStream(GZ_PATH));
  console.log(
    `[bake-gz] entity_reading=${er} · ${DB_PATH} ${mb(statSync(DB_PATH).size)} → ${GZ_PATH} ${mb(statSync(GZ_PATH).size)}`,
  );
}

main().catch((err) => {
  console.error(`[bake-gz] 오류: ${err.message}`);
  process.exitCode = 1;
});
