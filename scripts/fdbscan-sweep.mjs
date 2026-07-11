/**
 * @Project: kr-history-bm25
 * @File: fdbscan-sweep.mjs
 * @Description: FDBSCAN 파라미터 sweep 게이트 — 동봉 코퍼스에서 (minCooc·simMin·muMin) 격자 × 대표 seed로
 *               군집 수·노이즈율·최대군집비율을 집계해 병리(전부 노이즈/거대 단일군집) 없는 기본값을 고른다.
 *               결과를 tmp/fdbscan-sweep.json에 기록(재현성). dist 빌드 후 실행.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { openBundledDb } from '../dist/index.js';

const SEEDS = ['樂浪', '浿水', '平壤', '遼東', '玄菟'];
const SCOPE = 'article';
const LIMIT = 200;
const GRID = { minCooc: [2, 3, 5], simMin: [0.05, 0.08, 0.12, 0.2], muMin: [0.2, 0.3, 0.5, 1.0] };

async function main() {
  const db = await openBundledDb();
  const rows = [];
  for (const minCooc of GRID.minCooc) {
    for (const simMin of GRID.simMin) {
      for (const muMin of GRID.muMin) {
        const agg = { clusters: 0, noiseRate: 0, maxRatio: 0, u: 0, n: 0 };
        for (const seed of SEEDS) {
          const r = await db.placeClusters(seed, {
            scope: SCOPE,
            minCooc,
            simMin,
            muMin,
            limit: LIMIT,
          });
          const u =
            1 +
            r.clusters.reduce((s, c) => s + c.members.filter((m) => m.membership === 1).length, 0) +
            r.noise.length;
          const usize = Math.max(u, 1);
          const maxCluster = r.clusters.reduce((mx, c) => Math.max(mx, c.members.length), 0);
          agg.clusters += r.clusters.length;
          agg.noiseRate += r.noise.length / usize;
          agg.maxRatio += maxCluster / usize;
          agg.u += usize;
          agg.n += 1;
        }
        rows.push({
          minCooc,
          simMin,
          muMin,
          clusters: +(agg.clusters / agg.n).toFixed(2),
          noiseRate: +(agg.noiseRate / agg.n).toFixed(3),
          maxRatio: +(agg.maxRatio / agg.n).toFixed(3),
          avgU: Math.round(agg.u / agg.n),
        });
      }
    }
  }
  db.close();

  // 병리 필터: 군집 2~8, 노이즈율 0.1~0.75, 최대군집비율 <0.85
  const ok = rows.filter(
    (r) =>
      r.clusters >= 2 &&
      r.clusters <= 8 &&
      r.noiseRate >= 0.1 &&
      r.noiseRate <= 0.75 &&
      r.maxRatio < 0.85,
  );
  // 선호: 최대군집비율 낮고(고르게 분할) 군집 3~6
  ok.sort((a, b) => Math.abs(a.clusters - 4) - Math.abs(b.clusters - 4) || a.maxRatio - b.maxRatio);

  mkdirSync('tmp', { recursive: true });
  writeFileSync(
    'tmp/fdbscan-sweep.json',
    JSON.stringify(
      { scope: SCOPE, limit: LIMIT, seeds: SEEDS, grid: GRID, rows, recommended: ok.slice(0, 5) },
      null,
      2,
    ),
  );

  console.log(`[sweep] ${rows.length} 조합, 병리없음 ${ok.length}건. 상위 추천:`);
  for (const r of ok.slice(0, 8)) {
    console.log(
      `  minCooc=${r.minCooc} simMin=${r.simMin} muMin=${r.muMin} → 군집 ${r.clusters} 노이즈 ${r.noiseRate} 최대비 ${r.maxRatio} (U~${r.avgU})`,
    );
  }
  if (ok.length === 0) {
    console.log('  ⚠️ 병리없는 조합 없음 — 격자 확대 필요');
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
