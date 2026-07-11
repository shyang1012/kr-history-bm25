/**
 * @Project: kr-history-bm25
 * @File: search.test.ts
 * @Description: 검색 프리미티브 — 한자 BM25·구조 조회·군집·이표기 확장 검증
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createDbConnection, type DbConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { ingestCorpus } from '../src/ingest/ingest-corpus';
import { searchHan } from '../src/search/search-han';
import { lookupPlace } from '../src/search/lookup-place';
import { cluster } from '../src/search/cluster';
import { withVariants, addVariantGroup } from '../src/search/variants';

const corpusDir = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));

describe('검색 프리미티브', () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
    await ingestCorpus(conn, { dir: corpusDir, code: 'tt', name: '테스트사서' });
  });

  it('searchHan — 한자 phrase가 BM25로 검색된다', async () => {
    const hits = await searchHan(conn.client, '金城');
    expect(hits.length).toBe(2); // 두 사서 본문
    const one = await searchHan(conn.client, '徐羅伐');
    expect(one.length).toBe(1);
    expect(one[0].textHan).toContain('徐羅伐');
  });

  it('searchHan — 한자가 없는 검색어는 빈 배열', async () => {
    expect(await searchHan(conn.client, '졸본')).toEqual([]);
  });

  it('lookupPlace — 표기 출현 위치를 사서·경로와 함께 반환', async () => {
    const occ = await lookupPlace(conn.client, '金城', { type: '지명' });
    expect(occ.length).toBe(2);
    expect(occ.every((o) => o.corpusCode === 'tt')).toBe(true);
    expect(occ[0].path).toContain('t');
  });

  it('cluster — 같은 기사에 공기하는 개체를 반환', async () => {
    const neighbors = await cluster(conn.client, '金城');
    const surfaces = neighbors.map((n) => n.surface);
    expect(surfaces).toContain('漢城'); // tt_002 동일 기사 공기
    expect(surfaces).toContain('赫居世'); // tt_001 동일 기사 공기
    expect(surfaces).not.toContain('金城'); // 자기 자신 제외
  });

  it('cluster — 이웃 유형 제한(지명만)', async () => {
    const neighbors = await cluster(conn.client, '金城', { neighborType: '지명' });
    expect(neighbors.every((n) => n.type === '지명')).toBe(true);
    expect(neighbors.map((n) => n.surface)).toContain('漢城');
  });

  it('cluster — scope=article(기본)은 같은 기사의 다른 문단 개체까지 공기로 묶는다', async () => {
    // tt_001: 金城(para2)과 赫居世(para1)는 같은 node, 다른 passage
    const neighbors = await cluster(conn.client, '金城', { scope: 'article' });
    const surfaces = neighbors.map((n) => n.surface);
    expect(surfaces).toContain('赫居世'); // 같은 기사(node) → 공기
    expect(surfaces).toContain('漢城'); // tt_002 같은 문단
  });

  it('cluster — scope=paragraph는 같은 문단으로 공기 범위를 좁힌다', async () => {
    const neighbors = await cluster(conn.client, '金城', { scope: 'paragraph' });
    const surfaces = neighbors.map((n) => n.surface);
    expect(surfaces).not.toContain('赫居世'); // 다른 문단 → 제외(좁아짐)
    expect(surfaces).toContain('漢城'); // tt_002 같은 문단 → 유지
  });

  it('withVariants — 이표기 그룹을 OR로 병합 검색', async () => {
    await addVariantGroup(
      conn.client,
      [
        { type: '지명', surface: '金城' },
        { type: '지명', surface: '漢城' },
      ],
      '테스트 이표기',
    );
    const result = await withVariants(conn.client, '金城');
    expect(result.surfaces.sort()).toEqual(['漢城', '金城'].sort());
    expect(result.hits.length).toBe(2); // 金城(2 passages)∪漢城(1) = 2 distinct
  });
});
