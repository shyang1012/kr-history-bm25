/**
 * @Project: kr-history-bm25
 * @File: classify-review-chars.mjs
 * @Description: 독음 검수 큐(원음 미확정 char)를 Unihan 변이 필드로 기계 분류한다. 검수 char의 변이대상이
 *               확정 단일 본음을 가지면 그 독음을 상속(krh-cgh 이관), 아니면 LLM 검수 대상(residual)으로 남긴다.
 *               입력 기준집합은 reading-export의 chars로 고정(input_sha), 결과는 canonical 매니페스트로 영속한다.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@libsql/client';
import { openHistoryDb, loadVariantMap, classifyByVariant } from '../dist/index.js';

/** --옵션 파싱(간단) */
function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const DB = arg('db', undefined);
if (!DB) {
  console.error('🔴 --db 필수(미지정 시 원본 오염 방지). 예: --db data/history.reading.sqlite');
  process.exit(1);
}
/** 원본(교체 대상) DB — base_db_sha 산출용. work-copy가 아니라 원본을 해싱해 Step8에서 미변경 검증 */
const BASE_DB = arg('base-db', 'data/history.sqlite');
const VARIANTS = arg('variants', 'source/unihan/Unihan_Variants.txt');
const SEEDS = arg('seeds', 'data/reading-seeds.json');
const RUN_ID = arg('run-id', `krh4lr-${DB.replace(/[^a-z0-9]/gi, '')}`);
const MANIFEST = arg('manifest', 'data/reading-review-manifest.json');
const MIGRATE = arg('migrate', 'data/reading-variant-migrate.json');
const RESIDUAL = arg('residual', 'tmp/reading-review-residual.json');

/** 확정 단일 본음 판정: seed/llm(seq=-1) 우선, 없으면 비두음 후보 정확히 1개일 때만 반환, 아니면 null */
function makeSingleReadingOf(charRows) {
  const byChar = new Map();
  for (const r of charRows) {
    const list = byChar.get(r.char) ?? [];
    list.push(r);
    byChar.set(r.char, list);
  }
  return (ch) => {
    const list = byChar.get(ch);
    if (!list || list.length === 0) return null;
    const confirmed = list.find((r) => r.source === 'seed' || r.source === 'llm' || r.seq === -1);
    if (confirmed) return confirmed.reading;
    const bon = list.filter((r) => r.isDueum === 0);
    return bon.length === 1 ? bon[0].reading : null;
  };
}

async function main() {
  // base_db_sha = 원본(교체 대상) DB 해시(Step8 미변경 검증용). work-copy 아님.
  const baseDbSha = createHash('sha256').update(readFileSync(BASE_DB)).digest('hex');

  // 1) 기준집합: reading-export chars(seed 반영) — 유일 입력 계약(F-05)
  const db = await openHistoryDb(DB);
  const exported = await db.exportReadingChars(SEEDS);
  db.close();
  const reviewChars = exported.chars.map((c) => c.char);
  const reasonOf = new Map(exported.chars.map((c) => [c.char, c.reason]));
  const inputSha = createHash('sha256')
    .update([...reviewChars].sort().join('\n'))
    .digest('hex');

  // 2) char_reading 로드(singleReadingOf 재료)
  const client = createClient({ url: `file:${DB}` });
  const rows = (
    await client.execute('SELECT char, reading, seq, is_dueum, source FROM char_reading')
  ).rows.map((r) => ({
    char: String(r.char),
    reading: String(r.reading),
    seq: Number(r.seq),
    isDueum: Number(r.is_dueum),
    source: String(r.source),
  }));
  client.close();
  const singleReadingOf = makeSingleReadingOf(rows);

  // 3) 변이 분류 — 🔴 rare(자체 독음 없음)에만 적용. polyphone(자체 후보 독음 보유)은 변이 이관 금지,
  //    자체 독음을 LLM으로 원음 확정해야 함(예: 兒=아를 간체 儿=인으로 상속하면 오류·F-02).
  const rareChars = reviewChars.filter((ch) => reasonOf.get(ch) === 'rare');
  const polyChars = reviewChars.filter((ch) => reasonOf.get(ch) === 'polyphone');
  const variantMap = loadVariantMap(VARIANTS);
  const { resolvedByVariant, residual: rareUnresolved } = classifyByVariant(
    rareChars,
    variantMap,
    singleReadingOf,
  );

  // 4) 최종 3-상태 분류:
  //    변이이관 = rare + 변이 해소, 미해결 = rare + 변이 미해소(근거 없음, LLM 판정 안 함),
  //    검수대기(→원음확정/미해결) = polyphone(자체 후보 독음=근거, Step4 LLM 판정 대상).
  const total = resolvedByVariant.length + rareUnresolved.length + polyChars.length;
  if (total !== reviewChars.length) {
    console.error(
      `🔴 정합 위반: 변이이관 ${resolvedByVariant.length} + 미해결(rare) ${rareUnresolved.length} + 검수대기(poly) ${polyChars.length} = ${total} ≠ ${reviewChars.length}`,
    );
    process.exit(2);
  }

  // 5) canonical 매니페스트(감사자산). polyphone은 '검수대기' — Step4 LLM 후 원음확정/미해결로 갱신.
  const migrateSet = new Map(resolvedByVariant.map((m) => [m.char, m]));
  const polySet = new Set(polyChars);
  const manifest = {
    source: {
      run_id: RUN_ID,
      export_count: reviewChars.length,
      input_sha: inputSha,
      base_db_sha: baseDbSha,
      work_db_sha: null,
      created_at: new Date().toISOString(),
    },
    chars: reviewChars.map((ch) => {
      const via = migrateSet.get(ch);
      const final_status = via ? '변이이관' : polySet.has(ch) ? '검수대기' : '미해결';
      return {
        char: ch,
        initial_reason: reasonOf.get(ch) ?? null,
        final_status,
        variant_evidence: via ? { via: via.via, viaField: via.viaField, reading: via.reading } : null,
        llm: null,
        timestamp: new Date().toISOString(),
      };
    }),
  };

  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));
  writeFileSync(MIGRATE, JSON.stringify({ run_id: RUN_ID, count: resolvedByVariant.length, chars: resolvedByVariant }, null, 2));
  // residual.json = LLM 검수 대상(polyphone). 후보 독음 병기(판정 근거).
  writeFileSync(
    RESIDUAL,
    JSON.stringify(
      {
        run_id: RUN_ID,
        count: polyChars.length,
        chars: polyChars.map((ch) => ({
          char: ch,
          candidates: (exported.chars.find((c) => c.char === ch) ?? {}).candidates ?? [],
        })),
      },
      null,
      2,
    ),
  );

  console.log(
    `[classify] 기준 ${reviewChars.length} = 변이이관 ${resolvedByVariant.length} + 미해결(rare) ${rareUnresolved.length} + 검수대기(poly/LLM) ${polyChars.length}`,
  );
  console.log(`[classify] manifest→${MANIFEST}  migrate→${MIGRATE}  residual(LLM)→${RESIDUAL}`);
  console.log(`[classify] input_sha=${inputSha.slice(0, 12)} base_db_sha=${baseDbSha.slice(0, 12)}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
