/**
 * @Project: kr-history-bm25
 * @File: batch.test.ts
 * @Description: exportPending·importResults — 구독 모델 직역 배치 흐름(내보내기·적재·증분 재개·빈 직역 스킵) 검증
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createDbConnection, type DbConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { ingestCorpus } from '../src/ingest/ingest-corpus';
import { exportPending, importResults } from '../src/translate/batch';
import { searchKo } from '../src/search/search-ko';

const corpusDir = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));

describe('translate batch flow', () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
    await ingestCorpus(conn, { dir: corpusDir, code: 'tt', name: '테스트사서' });
  });

  it('exportPending — 대기 본문 전건을 id 순 JSON 형태로 내보낸다', async () => {
    const result = await exportPending(conn, { provider: 'codex' });
    expect(result.provider).toBe('codex');
    expect(result.count).toBe(3);
    expect(result.passages.length).toBe(3);
    for (const p of result.passages) {
      expect(typeof p.id).toBe('number');
      expect(typeof p.han).toBe('string');
      expect(p.han.length).toBeGreaterThan(0);
    }
    // id 순 정렬
    const ids = result.passages.map((p) => p.id);
    expect(ids).toEqual([...ids].sort((a, b) => a - b));
  });

  it('importResults — 결과를 적재하면 채택·ko FTS 색인·잔여 수 갱신이 이뤄진다', async () => {
    const exported = await exportPending(conn, { provider: 'codex' });
    const results = exported.passages.map((p) => ({
      id: p.id,
      ko: p.han.includes('金城') ? '금성(金城) 지역' : `직역: ${p.han}`,
    }));

    const stats = await importResults(conn, { provider: 'codex', model: 'gpt-5.4-mini', results });
    expect(stats.imported).toBe(3);
    expect(stats.skipped).toBe(0);
    expect(stats.remaining).toBe(0);

    const hits = await searchKo(conn.client, '금성');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].koText).toContain('金城');
    expect(hits[0].textHan).toContain('金城');

    const row = await conn.client.execute({
      sql: `SELECT status, adopted, model
              FROM translation
             WHERE passage_id = ? AND provider = 'codex'`,
      args: [exported.passages[0].id],
    });
    expect(row.rows[0].status).toBe('done');
    expect(Number(row.rows[0].adopted)).toBe(1);
    expect(row.rows[0].model).toBe('gpt-5.4-mini');
  });

  it('재실행 시(이미 done) exportPending은 해당 본문을 제외한다(증분/재개)', async () => {
    const result = await exportPending(conn, { provider: 'codex' });
    expect(result.count).toBe(0);
    expect(result.passages).toEqual([]);
  });

  it('빈 ko(공백만 포함)는 건너뛰고 카운트한다', async () => {
    const result = await exportPending(conn, { provider: 'codex2' });
    expect(result.count).toBe(3);

    const results = [
      { id: result.passages[0].id, ko: '' },
      { id: result.passages[1].id, ko: '   ' },
      { id: result.passages[2].id, ko: '직역: 유효' },
    ];
    const stats = await importResults(conn, { provider: 'codex2', results });
    expect(stats.imported).toBe(1);
    expect(stats.skipped).toBe(2);
    expect(stats.remaining).toBe(2);

    const after = await exportPending(conn, { provider: 'codex2' });
    expect(after.count).toBe(2);
    expect(after.passages.map((p) => p.id)).not.toContain(result.passages[2].id);
  });

  it('limit·corpus 옵션이 exportPending에 반영된다', async () => {
    const limited = await exportPending(conn, { provider: 'codex3', limit: 1 });
    expect(limited.count).toBe(1);

    const filtered = await exportPending(conn, { provider: 'codex3', corpusCode: '존재안함' });
    expect(filtered.count).toBe(0);
  });
});
