/**
 * @Project: kr-history-bm25
 * @File: select-kr-pilot.mjs
 * @Description: 고려사(kr) 직역 파일럿 층화 셀렉트(read-only). node.type(世家/志/列傳/年表/고려세계)와
 *               char_count 버킷(단/중/장문)을 가로질러 표본을 골라 배치 export 형식으로 tmp/kr-pilot.json에 쓴다.
 *               志에는 지리지 비정 표기(夲/本 포함) passage를 반드시 섞는다. translate-export --limit는 p.id
 *               순 상위 N건이라 층화가 안 되므로 이 스크립트로 대체한다. DB에 쓰지 않는다.
 *               사용: node scripts/select-kr-pilot.mjs [out=tmp/kr-pilot.json]
 * @Author: shyang
 * @LastModified: 2026-07-13
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createClient } from '@libsql/client';

const DB = 'data/history.sqlite';
const PROVIDER = 'claude';
const OUT = process.argv[2] ?? 'tmp/kr-pilot.json';

/** 층별 목표 표본 수(대략 ~200건). 志는 별도로 지리지(夲/本)분을 선확보 후 채운다. */
const QUOTA = { 世家: 70, 志: 70, 列傳: 40, 年表: 12, 고려세계: 8 };
/** 志 목표 중 지리지 비정 표기(夲/本) passage로 반드시 채울 최소 건수 */
const JIRIJI_MIN = 20;
/** 장문(>150자) 최소 확보 건수(구조 붕괴 확인용) */
const LONG_MIN = 5;

/** char_count 버킷 경계 */
const bucketOf = (n) => (n < 40 ? 'short' : n <= 150 ? 'mid' : 'long');

/**
 * 배열에서 균등 간격으로 k개를 뽑는다(저 id 편중 방지, 결정적).
 * @param {Array} arr - 원본(정렬된) 배열
 * @param {number} k - 뽑을 수
 * @returns {Array} 균등 표본
 */
function spread(arr, k) {
  if (k >= arr.length) return arr.slice();
  const out = [];
  const step = arr.length / k;
  for (let i = 0; i < k; i += 1) out.push(arr[Math.floor(i * step)]);
  return out;
}

const db = createClient({ url: `file:${DB}` });

/** kr 미완(claude done 없음) passage 전량을 유형·버킷 메타와 함께 조회 */
const rows = (
  await db.execute({
    sql: `
      SELECT p.id AS id, p.text_han AS han, p.char_count AS cc, n.type AS type
        FROM passage p
        JOIN corpus c ON c.id = p.corpus_id
        JOIN node n ON n.id = p.node_id
       WHERE c.code = 'kr'
         AND NOT EXISTS (
               SELECT 1 FROM translation t
                WHERE t.passage_id = p.id AND t.provider = ? AND t.status = 'done'
         )
       ORDER BY p.id
    `,
    args: [PROVIDER],
  })
).rows.map((r) => ({
  id: Number(r.id),
  han: String(r.han),
  cc: Number(r.cc),
  type: String(r.type),
  bucket: bucketOf(Number(r.cc)),
}));

const picked = new Map(); // id -> row (중복 방지)
const take = (row) => picked.set(row.id, row);

// 1) 志 지리지 비정 표기(夲/本) 선확보
const jiriji = rows.filter((r) => r.type === '志' && /[夲本]/.test(r.han));
for (const r of spread(jiriji, JIRIJI_MIN)) take(r);

// 2) 유형별 쿼터를 버킷 균등으로 채움
for (const [type, quota] of Object.entries(QUOTA)) {
  const pool = rows.filter((r) => r.type === type && !picked.has(r.id));
  const already = [...picked.values()].filter((r) => r.type === type).length;
  const need = Math.max(0, quota - already);
  if (need === 0) continue;
  // 버킷별로 need를 3분할(장문은 희소하므로 남는 몫은 다른 버킷이 흡수)
  const byBucket = { short: [], mid: [], long: [] };
  for (const r of pool) byBucket[r.bucket].push(r);
  const perBucket = Math.ceil(need / 3);
  const chosen = [
    ...spread(byBucket.long, perBucket),
    ...spread(byBucket.mid, perBucket),
    ...spread(byBucket.short, perBucket),
  ].slice(0, need);
  for (const r of chosen) take(r);
}

// 3) 장문 최소 보증
const longPicked = [...picked.values()].filter((r) => r.bucket === 'long').length;
if (longPicked < LONG_MIN) {
  const longPool = rows.filter((r) => r.bucket === 'long' && !picked.has(r.id));
  for (const r of spread(longPool, LONG_MIN - longPicked)) take(r);
}

const passages = [...picked.values()].sort((a, b) => a.id - b.id).map((r) => ({ id: r.id, han: r.han }));
const result = { provider: PROVIDER, count: passages.length, passages };

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, JSON.stringify(result, null, 2), 'utf-8');

// 층화 분포 요약(검토용, stderr)
const dist = {};
for (const r of picked.values()) {
  const k = `${r.type}/${r.bucket}`;
  dist[k] = (dist[k] ?? 0) + 1;
}
const jirijiCount = [...picked.values()].filter((r) => r.type === '志' && /[夲本]/.test(r.han)).length;
console.error(`[select-kr-pilot] total=${result.count} 지리지(夲/本)=${jirijiCount} → ${OUT}`);
console.error('[select-kr-pilot] dist:', JSON.stringify(dist, null, 0));
