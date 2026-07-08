/**
 * @Project: kr-history-bm25
 * @File: bundled-db.test.ts
 * @Description: 동봉 코퍼스 — 첫 사용 시 data/로 압축 해제 후 즉시 검색 검증. data/history.sqlite.gz 있을 때만 실행.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { describe, it, expect } from 'vitest';
import { existsSync, rmSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openBundledDb, findDataDir } from '../src/bundled-db';

const gzPath = fileURLToPath(new URL('../data/history.sqlite.gz', import.meta.url));
const hasBundle = existsSync(gzPath);

describe.skipIf(!hasBundle)('openBundledDb', () => {
  it('압축본을 data/로 풀고 즉시 검색된다', async () => {
    const dbPath = fileURLToPath(new URL('../data/history.sqlite', import.meta.url));
    rmSync(dbPath, { force: true }); // 압축 해제 경로 강제

    const db = await openBundledDb();
    expect(existsSync(findDataDir())).toBe(true);
    expect(existsSync(dbPath)).toBe(true); // data/로 풀림

    const hits = await db.searchHan('卒本', { limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].textHan).toContain('卒本');
    db.close();
  });

  it('두 번째 호출은 기존 압축 해제본을 재사용한다', async () => {
    const db = await openBundledDb();
    const hits = await db.searchHan('平壤', { limit: 1 });
    expect(hits.length).toBeGreaterThan(0);
    db.close();
  });
});
