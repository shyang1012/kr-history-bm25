/**
 * @Project: kr-history-bm25
 * @File: translate.test.ts
 * @Description: translateCorpus — 증분 직역·채택·보조 FTS 갱신·재개·실패 재시도 검증(mock provider)
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createDbConnection, type DbConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { ingestCorpus } from '../src/ingest/ingest-corpus';
import { translateCorpus } from '../src/translate/translate-corpus';
import { searchKo } from '../src/search/search-ko';
import type { TranslationProvider, TranslationResult } from '../src/translate/provider';

const corpusDir = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));

/** 결정적 mock — 한자 원문을 고정 직역으로 매핑 */
class MockProvider implements TranslationProvider {
  readonly name = 'mock';

  failFirst: boolean;

  private calls = 0;

  constructor(failFirst = false) {
    this.failFirst = failFirst;
  }

  async translate(han: string): Promise<TranslationResult> {
    this.calls += 1;
    if (this.failFirst && this.calls === 1) {
      throw new Error('일시 오류');
    }
    // 지명은 한자 보존, 나머지는 간이 직역 토큰
    const ko = han.includes('金城') ? '금성(金城) 지역' : `직역: ${han}`;
    return { text: ko, model: 'mock-1' };
  }
}

describe('translateCorpus', () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
    await ingestCorpus(conn, { dir: corpusDir, code: 'tt', name: '테스트사서' });
  });

  it('미완 본문을 직역·채택하고 통계를 낸다', async () => {
    const stats = await translateCorpus(conn, { provider: new MockProvider() });
    expect(stats.attempted).toBe(3);
    expect(stats.translated).toBe(3);
    expect(stats.failed).toBe(0);
    expect(stats.remaining).toBe(0);
  });

  it('채택된 직역이 보조 FTS(ko)로 검색된다', async () => {
    const hits = await searchKo(conn.client, '금성');
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].koText).toContain('金城'); // 지명 한자 보존
    expect(hits[0].textHan).toContain('金城'); // 원문 동반
  });

  it('재개 시 이미 done인 본문은 건너뛴다(증분)', async () => {
    const stats = await translateCorpus(conn, { provider: new MockProvider() });
    expect(stats.attempted).toBe(0);
    expect(stats.translated).toBe(0);
    expect(stats.remaining).toBe(0);
  });

  it('limit로 처리량을 제한한다', async () => {
    // 새 provider(mock2)는 아직 done이 없으므로 3건 대기 → limit 1
    const stats = await translateCorpus(conn, { provider: new NamedMock('mock2'), limit: 1 });
    expect(stats.attempted).toBe(1);
    expect(stats.remaining).toBe(2);
  });

  it('실패 본문은 재시도 대상으로 남는다', async () => {
    const provider = new NamedMock('mock3', true);
    const first = await translateCorpus(conn, { provider });
    expect(first.failed).toBe(1);
    expect(first.translated).toBe(2);
    expect(first.remaining).toBe(1); // 실패 1건은 미완으로 남음
    // 재실행 시 실패분만 재시도되어 성공
    const second = await translateCorpus(conn, { provider });
    expect(second.attempted).toBe(1);
    expect(second.translated).toBe(1);
    expect(second.remaining).toBe(0);
  });
});

/** 이름 지정 가능한 mock(다중 provider 시나리오용) */
class NamedMock implements TranslationProvider {
  readonly name: string;

  private failFirst: boolean;

  private calls = 0;

  constructor(name: string, failFirst = false) {
    this.name = name;
    this.failFirst = failFirst;
  }

  async translate(han: string): Promise<TranslationResult> {
    this.calls += 1;
    if (this.failFirst && this.calls === 1) {
      throw new Error('일시 오류');
    }
    return { text: `직역: ${han}`, model: `${this.name}-1` };
  }
}
