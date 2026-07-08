/**
 * @Project: kr-history-bm25
 * @File: ingest.test.ts
 * @Description: ingestCorpus — 적재 통계·개체 공유·FTS 색인·재적재 멱등성 검증
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createDbConnection, type DbConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { ingestCorpus } from '../src/ingest/ingest-corpus';

const corpusDir = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));

describe('ingestCorpus', () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
  });

  it('두 파일을 적재하고 통계를 집계한다(개체는 사서 교차로 공유)', async () => {
    const stats = await ingestCorpus(conn, { dir: corpusDir, code: 'tt', name: '테스트사서' });
    expect(stats.files).toBe(2);
    expect(stats.nodes).toBe(4); // 파일당 level1+level2 = 2, ×2
    expect(stats.passages).toBe(3); // tt_001: 2, tt_002: 1
    expect(stats.mentions).toBe(5); // 赫居世,徐羅伐,金城 / 金城,漢城 (卒本은 주석 내부라 제외)
    expect(stats.annotations).toBe(1);
    // 개체: 赫居世,徐羅伐,金城,漢城 = 4 (金城 중복은 1개로 수렴)
    expect(stats.newEntities).toBe(4);
  });

  it('한자 phrase가 주 FTS로 검색된다', async () => {
    const hit = await conn.client.execute(
      'SELECT rowid FROM passage_fts_han WHERE passage_fts_han MATCH \'"徐 羅 伐"\'',
    );
    expect(hit.rows.length).toBe(1);
  });

  it('金城은 두 사서 본문에 출현하며 하나의 개체로 연결된다', async () => {
    const rows = await conn.client.execute(
      `SELECT COUNT(*) AS c
         FROM entity_mention m
         JOIN entity e ON e.id = m.entity_id
        WHERE e.type = '지명' AND e.surface = '金城'`,
    );
    expect(Number(rows.rows[0].c)).toBe(2);
  });

  it('재적재 시 본문은 갱신되고 개체는 재사용된다(멱등)', async () => {
    const stats = await ingestCorpus(conn, { dir: corpusDir, code: 'tt', name: '테스트사서' });
    expect(stats.passages).toBe(3);
    expect(stats.newEntities).toBe(0); // 이미 존재
    const total = await conn.client.execute('SELECT COUNT(*) AS c FROM passage');
    expect(Number(total.rows[0].c)).toBe(3); // 중복 누적 없음
  });
});
