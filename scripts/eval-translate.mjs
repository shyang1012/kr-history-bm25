/**
 * @Project: kr-history-bm25
 * @File: eval-translate.mjs
 * @Description: 직역 품질 평가 하니스(검토용). 코어 대표 샘플을 provider로 직역해 원문↔직역을 출력한다. DB에 쓰지 않음.
 *               사용: [CF_ACCOUNT_ID=.. CF_API_TOKEN=.. CF_MODEL=@cf/google/gemma-4-26b-a4b-it] node scripts/eval-translate.mjs [provider]
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { readFileSync, existsSync } from 'node:fs';
import { createClient } from '@libsql/client';
import { createProvider } from '../dist/index.js';

// .dev.vars(있으면) 로드 — code-wiz에서 복제한 CF 자격증명. 값은 출력하지 않는다.
if (existsSync('.dev.vars')) {
  for (const line of readFileSync('.dev.vars', 'utf-8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !line.trimStart().startsWith('#') && process.env[m[1]] === undefined) {
      process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}

const DB = 'data/history.sqlite';
const providerName = process.argv[2] ?? 'cloudflare';
// CF 평가 기본 모델(검토 대상). env로 덮어쓸 수 있음.
if (providerName === 'cloudflare' && !process.env.CF_MODEL) {
  process.env.CF_MODEL = '@cf/google/gemma-4-26b-a4b-it';
}

/** 코어(삼국사기·삼국유사)에서 유형별 대표 샘플을 고른다 */
const SELECT = `
  SELECT co.code AS corpus_code, p.node_id, p.char_count, p.text_han
    FROM passage p
    JOIN corpus co ON co.id = p.corpus_id
   WHERE p.node_id IN (
         'sg_001_0020_0010'  /* 짧은 서사(시조 혁거세) */
       , 'sg_032_0020_0200'  /* 지명 밀집: 소사 산악 */
       , 'sg_037_0030_0180'  /* 지리지: 夲(본래) 표기 */
   )
   GROUP BY p.node_id
   UNION ALL
  SELECT co.code, p.node_id, p.char_count, p.text_han
    FROM passage p
    JOIN corpus co ON co.id = p.corpus_id
   WHERE co.code = 'sy' AND p.char_count BETWEEN 40 AND 90
     AND p.text_han NOT LIKE '%년%'
   LIMIT 2
`;

async function main() {
  const client = createClient({ url: `file:${DB}` });
  const rows = (await client.execute(SELECT)).rows;
  client.close();

  const provider = createProvider(providerName);
  console.log(`\n=== 직역 평가: provider=${providerName} model=${process.env.CF_MODEL ?? '(기본)'} ===`);
  for (const r of rows) {
    const han = String(r.text_han);
    process.stdout.write(`\n[${r.corpus_code} ${r.node_id} · ${r.char_count}자]\n원문: ${han}\n직역: `);
    try {
      const out = await provider.translate(han, { passageId: 0, nodeId: String(r.node_id) });
      console.log(out.text);
    } catch (e) {
      console.log(`(오류: ${e.message})`);
    }
  }
}

main().catch((e) => {
  console.error(`[eval] 오류: ${e.message}`);
  process.exitCode = 1;
});
