/**
 * @Project: kr-history-bm25
 * @File: fdbscan-sweep.mjs
 * @Description: FDBSCAN 파라미터 sweep 게이트 — 동봉 코퍼스에서 (minCooc·simMin·muMin) 격자 × 대표 seed로
 *               병리 지표를 집계해 병리 없는 기본값을 검증한다. 분모는 |U|=seed+모든 고유 이웃이며 core/border/
 *               noise를 분리 집계한다(Phase 1 교정, krh 자동파라미터 제안). tmp/fdbscan-sweep.json 기록.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { writeFileSync, mkdirSync } from 'node:fs';
import { openBundledDb } from '../dist/index.js';

const TUNING = ['樂浪', '浿水', '平壤', '遼東', '玄菟'];
const HOLDOUT = ['鐵嶺', '慈悲嶺', '鴨綠', '卒本', '完山']; // 코퍼스 실재 확인, 희소·중빈도 혼합
const SCOPE = 'article';
const LIMIT = 200;
const GRID = { minCooc: [2, 3, 5], simMin: [0.05, 0.08, 0.12, 0.2], muMin: [0.2, 0.3, 0.5, 1.0] };

/**
 * PlaceClusterResult에서 교정 지표 산출. |U|=seed+모든 고유 이웃(=군집 고유멤버 ∪ 노이즈).
 * core=단일 군집 membership 1, border=그 외(비코어 소속), core/fuzzy 군집 크기 분리.
 */
function metricsOf(r) {
  const memBySurface = new Map();
  const coreSize = new Map();
  const fuzzySize = new Map();
  for (const c of r.clusters) {
    let coreN = 0;
    for (const m of c.members) {
      const arr = memBySurface.get(m.surface) ?? [];
      arr.push(m.membership);
      memBySurface.set(m.surface, arr);
      if (m.membership === 1) coreN += 1;
    }
    coreSize.set(c.clusterId, coreN);
    fuzzySize.set(c.clusterId, c.members.length);
  }
  const U = new Set([...memBySurface.keys(), ...r.noise]).size || 1;
  let border = 0;
  let multiBorder = 0;
  let entropySum = 0;
  let entropyN = 0;
  for (const mems of memBySurface.values()) {
    const isCore = mems.length === 1 && mems[0] === 1;
    if (isCore) {
      continue;
    }
    border += 1;
    if (mems.length >= 2) {
      multiBorder += 1;
    }
    const total = mems.reduce((s, m) => s + m, 0) || 1;
    let e = 0;
    for (const m of mems) {
      const p = m / total;
      if (p > 0) {
        e -= p * Math.log(p);
      }
    }
    entropySum += e;
    entropyN += 1;
  }
  const maxOf = (map) => (map.size ? Math.max(...map.values()) : 0);
  return {
    clusters: r.clusters.length,
    U,
    noiseRate: r.noise.length / U,
    maxCoreClusterRatio: maxOf(coreSize) / U,
    maxFuzzyClusterRatio: maxOf(fuzzySize) / U,
    borderRate: border / U,
    multiClusterBorderRate: multiBorder / U,
    meanMembershipEntropy: entropyN ? entropySum / entropyN : 0,
  };
}

async function evalCombo(db, seeds, minCooc, simMin, muMin) {
  const agg = {
    clusters: 0,
    noiseRate: 0,
    maxCoreClusterRatio: 0,
    maxFuzzyClusterRatio: 0,
    borderRate: 0,
    multiClusterBorderRate: 0,
    meanMembershipEntropy: 0,
    n: 0,
  };
  for (const seed of seeds) {
    const r = await db.placeClusters(seed, { scope: SCOPE, minCooc, simMin, muMin, limit: LIMIT });
    const m = metricsOf(r);
    for (const k of Object.keys(agg)) {
      if (k !== 'n') agg[k] += m[k];
    }
    agg.n += 1;
  }
  const out = { minCooc, simMin, muMin };
  for (const k of Object.keys(agg)) {
    if (k !== 'n') out[k] = +(agg[k] / agg.n).toFixed(3);
  }
  return out;
}

async function main() {
  const db = await openBundledDb();
  const rows = [];
  for (const minCooc of GRID.minCooc) {
    for (const simMin of GRID.simMin) {
      for (const muMin of GRID.muMin) {
        rows.push(await evalCombo(db, TUNING, minCooc, simMin, muMin));
      }
    }
  }

  // 병리 필터(교정 지표): 군집 2~8, 노이즈율 0.1~0.75, 최대 fuzzy 군집비 <0.85
  const ok = rows.filter(
    (r) =>
      r.clusters >= 2 &&
      r.clusters <= 8 &&
      r.noiseRate >= 0.1 &&
      r.noiseRate <= 0.75 &&
      r.maxFuzzyClusterRatio < 0.85,
  );
  // 선호: fuzzy 군집이 지배하지 않고(낮은 maxFuzzyClusterRatio) 군집 3~6
  ok.sort(
    (a, b) =>
      Math.abs(a.clusters - 4) - Math.abs(b.clusters - 4) ||
      a.maxFuzzyClusterRatio - b.maxFuzzyClusterRatio,
  );

  // holdout 검증(상위 추천 1건 재확인)
  const best = ok[0];
  const holdout = best ? await evalCombo(db, HOLDOUT, best.minCooc, best.simMin, best.muMin) : null;
  db.close();

  mkdirSync('tmp', { recursive: true });
  writeFileSync(
    'tmp/fdbscan-sweep.json',
    JSON.stringify(
      {
        scope: SCOPE,
        limit: LIMIT,
        tuning: TUNING,
        holdout: HOLDOUT,
        grid: GRID,
        rows,
        recommended: ok.slice(0, 5),
        holdoutCheck: holdout,
      },
      null,
      2,
    ),
  );

  console.log(`[sweep] ${rows.length} 조합, 병리없음 ${ok.length}건. 상위 추천(교정 지표):`);
  for (const r of ok.slice(0, 8)) {
    console.log(
      `  minCooc=${r.minCooc} simMin=${r.simMin} muMin=${r.muMin} → 군집 ${r.clusters} 노이즈 ${r.noiseRate} maxFuzzy ${r.maxFuzzyClusterRatio} border ${r.borderRate} 엔트로피 ${r.meanMembershipEntropy}`,
    );
  }
  if (holdout) {
    console.log(
      `[holdout] ${best.minCooc}/${best.simMin}/${best.muMin} → 군집 ${holdout.clusters} 노이즈 ${holdout.noiseRate} maxFuzzy ${holdout.maxFuzzyClusterRatio}`,
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
