/**
 * @Project: kr-history-bm25
 * @File: build-embeddings.mjs
 * @Description: 동봉 DB에 의미 벡터를 굽는다(krh-cvh Phase 1). sg/sy passage 원문(text_han)·직역(translation.text)을
 *               e5-small(번들 양자화 ONNX, 로컬 로드)로 임베딩 → int8 양자화 → passage_embedding insert →
 *               embedding_meta 기록 → 검증(F-09) → VACUUM + gzip 재생성. bake-readings-gz 패턴.
 *               실행: node scripts/build-embeddings.mjs (data/history.sqlite 또는 .gz 필요, models/ 필요).
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { createClient } from '@libsql/client';
import { pipeline, env } from '@huggingface/transformers';
import { existsSync, readFileSync, writeFileSync, createReadStream, createWriteStream } from 'node:fs';
import { gunzipSync, createGzip } from 'node:zlib';
import { pipeline as streamPipeline } from 'node:stream/promises';
import { resolve } from 'node:path';

const DB = resolve('data/history.sqlite');
const GZ = resolve('data/history.sqlite.gz');
const MODEL_ID = 'Xenova/multilingual-e5-small';
const DIM = 384;
const UNIVERSE = ['sg', 'sy'];
const BATCH = 64;

/** int8 양자화(vector-store.quantizeInt8와 동일 계약) */
function quantizeInt8(v) {
  const out = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(v[i] * 127)));
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/** 0004 스키마(idempotent) */
const DDL = `
CREATE TABLE IF NOT EXISTS passage_embedding (
    passage_id INTEGER NOT NULL, kind TEXT NOT NULL CHECK (kind IN ('han','ko')),
    vec BLOB NOT NULL, PRIMARY KEY (passage_id, kind));
CREATE TABLE IF NOT EXISTS embedding_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1), model TEXT NOT NULL, dim INTEGER NOT NULL,
    quant TEXT NOT NULL, built_at TEXT NOT NULL);
`;

async function main() {
  if (!existsSync(DB)) {
    if (!existsSync(GZ)) throw new Error('data/history.sqlite(.gz) 없음. build:corpus 먼저.');
    console.log('[embed] gz 해제…');
    writeFileSync(DB, gunzipSync(readFileSync(GZ)));
  }
  const client = createClient({ url: 'file:' + DB });
  await client.executeMultiple(DDL);

  console.log('[embed] sg/sy passage 로드…');
  const rows = (
    await client.execute(`
      SELECT p.id, p.text_han AS han, t.text AS ko
        FROM passage p
        JOIN corpus c ON c.id = p.corpus_id
        JOIN translation t ON t.passage_id = p.id AND t.adopted = 1
       WHERE c.code IN (${UNIVERSE.map((x) => `'${x}'`).join(',')})
       ORDER BY p.id`)
  ).rows;
  const ids = rows.map((r) => Number(r.id));
  console.log(`[embed] passage=${ids.length}`);

  // 번들 로컬 모델만 사용(다운로드 0), 양자화 로드
  env.allowRemoteModels = false;
  env.allowLocalModels = true;
  env.localModelPath = resolve('models');
  const extractor = await pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });

  async function embedAll(texts, prefix, kind) {
    let done = 0;
    for (let i = 0; i < texts.length; i += BATCH) {
      const slice = texts.slice(i, i + BATCH);
      const out = await extractor(
        slice.map((t) => prefix + String(t).slice(0, 512)),
        { pooling: 'mean', normalize: true },
      );
      const vecs = out.tolist();
      const stmts = vecs.map((v, j) => ({
        sql: 'INSERT OR REPLACE INTO passage_embedding (passage_id, kind, vec) VALUES (?, ?, ?)',
        args: [ids[i + j], kind, quantizeInt8(v)],
      }));
      await client.batch(stmts, 'write');
      done += slice.length;
      if (i % (BATCH * 8) === 0) console.log(`  [${kind}] ${done}/${texts.length}`);
    }
  }

  await client.execute('DELETE FROM passage_embedding');
  await embedAll(
    rows.map((r) => r.han),
    'passage: ',
    'han',
  );
  await embedAll(
    rows.map((r) => r.ko),
    'passage: ',
    'ko',
  );
  await client.execute({
    sql: `INSERT OR REPLACE INTO embedding_meta (id, model, dim, quant, built_at)
          VALUES (1, ?, ?, 'int8', ?)`,
    args: [MODEL_ID, DIM, new Date().toISOString()],
  });

  // --- 검증 게이트(F-09) ---
  const cnt = Number((await client.execute('SELECT COUNT(*) c FROM passage_embedding')).rows[0].c);
  const expected = ids.length * 2;
  const badLen = Number(
    (await client.execute(`SELECT COUNT(*) c FROM passage_embedding WHERE length(vec) <> ${DIM}`))
      .rows[0].c,
  );
  const meta = Number((await client.execute('SELECT COUNT(*) c FROM embedding_meta')).rows[0].c);
  console.log(`[verify] rows=${cnt}/${expected}  badLen=${badLen}  meta=${meta}`);
  if (cnt !== expected || badLen !== 0 || meta !== 1) {
    throw new Error(`검증 실패: rows=${cnt}/${expected}, badLen=${badLen}, meta=${meta}`);
  }

  await client.execute('VACUUM');
  client.close();

  console.log('[embed] gzip 재생성…');
  await streamPipeline(createReadStream(DB), createGzip({ level: 9 }), createWriteStream(GZ));
  console.log('[embed] 완료 → data/history.sqlite.gz (벡터 포함)');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
