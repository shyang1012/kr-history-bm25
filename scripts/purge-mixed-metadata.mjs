/**
 * @Project: kr-history-bm25
 * @File: purge-mixed-metadata.mjs
 * @Description: 혼재 metadata passage 소급 정정(krh-6a0, 일회성). 국편위 색인·편찬안내 문구(＞ / 『書名』卷)
 *               passage에 과거 잘못 적재된 직역(translation)과 보조 FTS(passage_fts_ko)를 삭제한다.
 *               passage 자체·한자 FTS는 건드리지 않는다. .mjs는 TS store 함수를 import할 수 없어 동일
 *               DELETE SQL을 자체 실행한다(src/translate/translation-store.ts purgeMixedMetadataTranslations와 동형).
 *               실행 전 preflight guard(대상이 sg/sy·sonnet·done만인지)로 예상 밖 삭제를 차단하고,
 *               data/history.sqlite → .bak 백업 후 진행한다.
 *               사용: node scripts/purge-mixed-metadata.mjs
 * @Author: shyang
 * @LastModified: 2026-07-14
 */
import { copyFileSync, existsSync, statSync } from 'node:fs';
import { createClient } from '@libsql/client';

const DB = 'data/history.sqlite';
const BAK = `${DB}.bak`;

/** 혼재 passage 선택 SQL 조각(store MIXED 조건과 동형) */
const MIXED = `SELECT id FROM passage WHERE text_han LIKE '%＞%' OR text_han LIKE '『%』卷%'`;

/** 승인된 소급 정정 범위 — 이 조합 외 대상이 있으면 abort */
const EXPECTED = { corpus: new Set(['sg', 'sy']), provider: 'sonnet', status: 'done', total: 442 };

/** 오류 후 즉시 종료 */
function abort(msg) {
  console.error(`\n🔴 ABORT — ${msg}\n삭제를 수행하지 않았습니다.`);
  process.exit(1);
}

const db = createClient({ url: `file:${DB}` });

// 1) 백업 체크리스트 -----------------------------------------------------------
if (!existsSync(DB)) abort(`${DB} 없음`);
if (existsSync(BAK)) abort(`${BAK} 이미 존재 — 기존 백업 덮어쓰기 방지. 수동 확인 후 제거하고 재실행.`);

const quick = await db.execute('PRAGMA quick_check');
const qc = String(quick.rows[0]?.quick_check ?? '');
if (qc !== 'ok') abort(`PRAGMA quick_check 실패: ${qc}`);

copyFileSync(DB, BAK);
if (statSync(BAK).size !== statSync(DB).size) abort('백업 크기 불일치');
console.log(`✔ 백업 완료: ${BAK} (${statSync(BAK).size} bytes), quick_check=ok`);

// 2) preflight guard — 혼재 translation 구성이 승인 범위와 일치하는지 -----------
const dist = await db.execute(`
  SELECT c.code AS code, t.provider AS provider, t.status AS status, COUNT(*) AS n
    FROM translation t
    JOIN passage p ON p.id = t.passage_id
    JOIN corpus c ON c.id = p.corpus_id
   WHERE p.id IN (${MIXED})
   GROUP BY c.code, t.provider, t.status
   ORDER BY c.code
`);
console.log('\n혼재 translation 분포:');
let total = 0;
let ok = true;
for (const r of dist.rows) {
  const n = Number(r.n);
  total += n;
  const bad =
    !EXPECTED.corpus.has(String(r.code)) ||
    String(r.provider) !== EXPECTED.provider ||
    String(r.status) !== EXPECTED.status;
  console.log(`  ${bad ? '✗' : '·'} ${r.code} / ${r.provider} / ${r.status} : ${n}`);
  if (bad) ok = false;
}
console.log(`  합계: ${total}`);
if (!ok) abort('예상 밖 corpus/provider/status 대상 존재');
if (total !== EXPECTED.total) abort(`총 대상 ${total} ≠ 승인 ${EXPECTED.total}`);

// 3) 삭제 (passage_fts_ko → translation) --------------------------------------
await db.batch(
  [`DELETE FROM passage_fts_ko WHERE passage_id IN (${MIXED})`, `DELETE FROM translation WHERE passage_id IN (${MIXED})`],
  'write',
);

// 4) 사후 검증 로그 ------------------------------------------------------------
const after = await db.execute(`SELECT COUNT(*) AS c FROM translation WHERE passage_id IN (${MIXED})`);
const afterFts = await db.execute(`SELECT COUNT(*) AS c FROM passage_fts_ko WHERE passage_id IN (${MIXED})`);
console.log(`\n✔ 삭제 완료 — 혼재 translation: ${total} → ${Number(after.rows[0].c)}`);
console.log(`✔ 혼재 passage_fts_ko 잔여: ${Number(afterFts.rows[0].c)}`);
console.log('검증 후 문제 없으면 백업(.bak) 정리, 문제 시 .bak 복원.');
