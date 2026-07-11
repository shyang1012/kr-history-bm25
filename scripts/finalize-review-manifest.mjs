/**
 * @Project: kr-history-bm25
 * @File: finalize-review-manifest.mjs
 * @Description: LLM 검수 결과(polyphone 판정)를 canonical 매니페스트에 접합하고 완료 불변식을 검증한다.
 *               검수대기→원음확정 갱신, work_db_sha 기록, 3-상태 유일성·완전성·상호배타성 + 매니페스트↔DB 정합
 *               (원음확정 char의 char_reading source='llm' 실재, 변이이관 char 미적재)을 확인한다(F-01·F-06·F-07).
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createClient } from '@libsql/client';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}
const DB = arg('db', undefined);
if (!DB) {
  console.error('🔴 --db 필수. 예: --db data/history.reading.sqlite');
  process.exit(1);
}
const MANIFEST = arg('manifest', 'data/reading-review-manifest.json');
const RESULTS = arg('results', 'tmp/reading-review-results.json');

const FINAL = new Set(['원음확정', '변이이관', '미해결']);

async function main() {
  const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));
  const results = JSON.parse(readFileSync(RESULTS, 'utf8'));
  const resultOf = new Map(results.map((r) => [r.char, r]));

  // 1) 검수대기(polyphone) → 원음확정/미해결 접합 + llm 블록(F-03 근거 영속)
  for (const entry of manifest.chars) {
    if (entry.final_status !== '검수대기') continue;
    const r = resultOf.get(entry.char);
    if (r && r.status === 'verified') {
      entry.final_status = '원음확정';
      entry.llm = { reading: r.reading, note: r.note ?? null, verdict: 'verified' };
    } else {
      entry.final_status = '미해결';
      entry.llm = { reading: null, note: r?.note ?? null, verdict: 'failed' };
    }
    entry.timestamp = new Date().toISOString();
  }

  // 2) work_db_sha 기록(F-06)
  manifest.source.work_db_sha = createHash('sha256').update(readFileSync(DB)).digest('hex');

  // 3) 완료 불변식(F-01)
  const errors = [];
  const seen = new Set();
  const dist = {};
  for (const e of manifest.chars) {
    if (seen.has(e.char)) errors.push(`중복 char: ${e.char}`);
    seen.add(e.char);
    if (!FINAL.has(e.final_status)) errors.push(`비최종 상태: ${e.char}=${e.final_status}`);
    dist[e.final_status] = (dist[e.final_status] || 0) + 1;
    if (e.final_status === '변이이관' && !e.variant_evidence) errors.push(`변이이관 근거없음: ${e.char}`);
    if (e.final_status === '원음확정' && !(e.llm && e.llm.verdict === 'verified')) errors.push(`원음확정 llm없음: ${e.char}`);
  }
  if (manifest.chars.length !== manifest.source.export_count)
    errors.push(`완전성 위반: ${manifest.chars.length} ≠ export ${manifest.source.export_count}`);

  // 4) 매니페스트↔DB 정합(F-06): 원음확정 char는 char_reading source='llm' 실재, 변이이관 char는 미적재(자체 독음 없음)
  const client = createClient({ url: `file:${DB}` });
  const llmRows = (await client.execute("SELECT char FROM char_reading WHERE source='llm'")).rows.map((r) => String(r.char));
  const llmSet = new Set(llmRows);
  const integrity = (await client.execute('PRAGMA integrity_check')).rows[0];
  client.close();

  for (const e of manifest.chars) {
    if (e.final_status === '원음확정' && !llmSet.has(e.char)) errors.push(`원음확정인데 DB llm 미실재: ${e.char}`);
    if (e.final_status === '변이이관' && llmSet.has(e.char)) errors.push(`변이이관인데 DB llm 적재됨(오염): ${e.char}`);
  }

  writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2));

  console.log('[finalize] 상태 분포:', JSON.stringify(dist));
  console.log(`[finalize] llm 확정 char(DB)=${llmSet.size}, integrity_check=${integrity ? Object.values(integrity)[0] : '?'}`);
  console.log(`[finalize] work_db_sha=${manifest.source.work_db_sha.slice(0, 12)} input_sha=${manifest.source.input_sha.slice(0, 12)}`);
  if (errors.length) {
    console.error('🔴 불변식 위반:\n  ' + errors.join('\n  '));
    process.exit(2);
  }
  console.log('✅ 완료 불변식·매니페스트↔DB 정합 통과.');
}
main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
