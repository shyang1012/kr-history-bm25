/**
 * @Project: kr-history-bm25
 * @File: split-batch-chunks.mjs
 * @Description: 배치 export JSON({provider,count,passages})을 Write에이전트 dispatch용 청크 파일로 분할한다(read-only 산출).
 *               각 청크는 [{id, han}] 배열. 에이전트가 자기 청크만 읽어 [{id, ko}]를 지정 파일에 기록하게 한다.
 *               사용: node scripts/split-batch-chunks.mjs <in.json> <outDir> [chunkSize=25]
 * @Author: shyang
 * @LastModified: 2026-07-13
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const IN = process.argv[2];
const DIR = process.argv[3];
const CHUNK = Number(process.argv[4] ?? 25);
if (!IN || !DIR) {
  console.error('usage: node scripts/split-batch-chunks.mjs <in.json> <outDir> [chunkSize]');
  process.exit(1);
}

const { passages } = JSON.parse(readFileSync(IN, 'utf-8'));
mkdirSync(DIR, { recursive: true });

let n = 0;
for (let i = 0; i < passages.length; i += CHUNK) {
  n += 1;
  const slice = passages.slice(i, i + CHUNK).map((p) => ({ id: p.id, han: p.han }));
  writeFileSync(`${DIR}/chunk-${String(n).padStart(2, '0')}.json`, JSON.stringify(slice, null, 2), 'utf-8');
}
console.error(`[split] ${passages.length} passages → ${n} chunks(size≤${CHUNK}) in ${DIR}/`);
