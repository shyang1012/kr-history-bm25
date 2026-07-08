/**
 * @Project: kr-history-bm25
 * @File: db-migrate.test.ts
 * @Description: 마이그레이션 러너 — 테이블/FTS 생성 및 멱등성 검증
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { describe, it, expect } from 'vitest';
import { createDbConnection, toLibsqlUrl } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';

describe('toLibsqlUrl', () => {
  it(':memory:는 그대로 반환한다', () => {
    expect(toLibsqlUrl(':memory:')).toBe(':memory:');
  });

  it('일반 경로를 file: 스킴으로 정규화한다', () => {
    expect(toLibsqlUrl('D:\\a\\b.sqlite')).toBe('file:D:/a/b.sqlite');
  });
});

describe('runMigrations', () => {
  it('관계형 테이블과 FTS5 가상테이블을 생성한다', async () => {
    const { client } = createDbConnection(':memory:');
    const applied = await runMigrations(client);
    expect(applied).toContain('0001-init');

    const tables = await client.execute(
      "SELECT name FROM sqlite_master WHERE type IN ('table') ORDER BY name",
    );
    const names = tables.rows.map((r) => String(r.name));
    for (const t of ['corpus', 'node', 'passage', 'entity', 'entity_mention', 'translation']) {
      expect(names).toContain(t);
    }
    expect(names).toContain('passage_fts_han');
    expect(names).toContain('passage_fts_ko');
    client.close();
  });

  it('재실행 시 이미 적용된 버전은 건너뛴다(멱등)', async () => {
    const { client } = createDbConnection(':memory:');
    await runMigrations(client);
    const second = await runMigrations(client);
    expect(second).toEqual([]);
    client.close();
  });

  it('FTS5 트리거가 passage 삽입을 색인해 phrase 검색된다', async () => {
    const { client } = createDbConnection(':memory:');
    await runMigrations(client);
    await client.execute({
      sql: `INSERT INTO passage (corpus_id, node_id, seq, text_han, han_indexed, char_count)
            VALUES (1, 'n1', 0, '卒本川', '卒 本 川', 3)`,
      args: [],
    });
    const hit = await client.execute(
      'SELECT rowid FROM passage_fts_han WHERE passage_fts_han MATCH \'"卒 本"\'',
    );
    expect(hit.rows.length).toBe(1);
    client.close();
  });
});
