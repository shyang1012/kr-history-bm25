/**
 * @Project: kr-history-bm25
 * @File: bundled-db.test.ts
 * @Description: 동봉 코퍼스 — 압축 해제 후 즉시 검색 검증. data/history.sqlite.gz 있을 때만 실행.
 *               🔴 격리 임시 디렉터리(targetDir)로 풀어 실제 data/history.sqlite(작업 DB)를 건드리지 않는다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openBundledDb } from '../src/bundled-db';

const gzPath = fileURLToPath(new URL('../data/history.sqlite.gz', import.meta.url));
const hasBundle = existsSync(gzPath);
const workDir = mkdtempSync(join(tmpdir(), 'krh-bundle-'));

afterAll(() => {
  // Windows에선 sqlite 파일 락으로 즉시 삭제가 EPERM일 수 있음 — 정리 실패는 무해(OS가 임시폴더 회수)
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* 임시폴더 정리 실패 무시 */
  }
});

describe.skipIf(!hasBundle)('openBundledDb', () => {
  it('압축본을 격리 디렉터리로 풀고 즉시 검색된다', async () => {
    const db = await openBundledDb({ targetDir: workDir });
    expect(existsSync(join(workDir, 'history.sqlite'))).toBe(true); // targetDir로 풀림

    const hits = await db.searchHan('卒本', { limit: 3 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].textHan).toContain('卒本');
    db.close();
  });

  it('두 번째 호출은 기존 압축 해제본을 재사용한다', async () => {
    const db = await openBundledDb({ targetDir: workDir });
    const hits = await db.searchHan('平壤', { limit: 1 });
    expect(hits.length).toBeGreaterThan(0);
    db.close();
  });
});
