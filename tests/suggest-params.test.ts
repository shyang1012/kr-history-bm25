/**
 * @Project: kr-history-bm25
 * @File: suggest-params.test.ts
 * @Description: suggestPlaceClusterParams 검증 — 분포 기반 결정론적 추천(순수 헬퍼 + 동봉 e2e). 추천만 하고
 *               실제 군집 기본 동작은 fixed 유지(Phase 2). 재현성(동일 입력 동일 추천) 확인.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { quantile, estimateMinCooc } from '../src/search/suggest-params';
import { openBundledDb } from '../src/bundled-db';

describe('suggest-params 순수 헬퍼', () => {
  it('quantile — 정렬 분포의 분위수(경계 clamp)', () => {
    const xs = [0.1, 0.2, 0.3, 0.4, 0.5];
    expect(quantile(xs, 0)).toBe(0.1);
    expect(quantile(xs, 1)).toBe(0.5);
    expect(quantile(xs, 0.5)).toBe(0.3);
    expect(quantile([], 0.5)).toBeUndefined();
  });

  it('estimateMinCooc — seed 빈도 로그스케일, [1,5] clamp', () => {
    expect(estimateMinCooc(0)).toBe(1); // 희소
    expect(estimateMinCooc(5)).toBe(1);
    expect(estimateMinCooc(100)).toBe(2); // log10≈2
    expect(estimateMinCooc(100000)).toBe(5); // 상한
  });
});

const gzPath = fileURLToPath(new URL('../data/history.sqlite.gz', import.meta.url));

describe.skipIf(!existsSync(gzPath))('suggestPlaceClusterParams — e2e(동봉)', () => {
  it('樂浪 파라미터 추천 — 유효 범위 + 재현성', async () => {
    const db = await openBundledDb();
    const s1 = await db.suggestPlaceClusterParams('樂浪', { scope: 'article' });
    const s2 = await db.suggestPlaceClusterParams('樂浪', { scope: 'article' });
    expect(s1).not.toBeNull();
    expect(s1).toEqual(s2); // 결정론(동일 입력 동일 추천)
    expect(s1!.minCooc).toBeGreaterThanOrEqual(1);
    expect(s1!.simMin).toBeGreaterThan(0);
    expect(s1!.simMin).toBeLessThanOrEqual(1);
    expect(s1!.muMin).toBeGreaterThan(0);
    expect(s1!.basis.neighborCount).toBeGreaterThan(0);
    db.close();
  });

  it('없는 seed는 null', async () => {
    const db = await openBundledDb();
    expect(await db.suggestPlaceClusterParams('없는지명XYZ', {})).toBeNull();
    db.close();
  });
});
