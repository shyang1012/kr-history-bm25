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
import {
  fetchPending,
  countPending,
  adopt,
  purgeMixedMetadataTranslations,
} from '../src/translate/translation-store';
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

/**
 * 혼재 metadata passage 필터(krh-6a0). 국편위 색인·편찬안내 문구(＞ / 『書名』卷)는 한문 원문이
 * 아니므로 직역 대상에서 제외하고, 과거 잘못 직역된 것은 소급 정정한다. 공유 fixture(tt)를 건드리면
 * ingest/translate 고정통계가 깨지므로 별도 corpus(mx)에 passage를 직접 적재해 격리 검증한다.
 */
describe('혼재 metadata 필터 (krh-6a0)', () => {
  let conn: DbConnection;
  /** 정상 passage id */
  let normalId: number;
  /** ＞ 혼재 passage id */
  let breadcrumbId: number;
  /** 『書名』卷 혼재 passage id */
  let bookRefId: number;

  /** mx 코퍼스에 passage 1건을 직접 적재하고 id를 돌려준다(트리거가 fts_han 동기화). */
  async function insertPassage(corpusId: number, text: string): Promise<number> {
    const res = await conn.client.execute({
      sql: `INSERT INTO passage (corpus_id, node_id, seq, text_han, han_indexed, char_count)
            VALUES (?, 'mx-n1', 0, ?, ?, ?)`,
      args: [corpusId, text, text, text.length],
    });
    return Number(res.lastInsertRowid);
  }

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
    const corpus = await conn.client.execute({
      sql: `INSERT INTO corpus (code, name, source_dir) VALUES ('mx', '혼재테스트', 'none')`,
    });
    const corpusId = Number(corpus.lastInsertRowid);
    await conn.client.execute({
      sql: `INSERT INTO node (id, corpus_id, level_no, path, seq) VALUES ('mx-n1', ?, 1, '/mx', 0)`,
      args: [corpusId],
    });
    normalId = await insertPassage(corpusId, '高麗遣使朝貢'); // 정상 한문
    breadcrumbId = await insertPassage(corpusId, '사료로보는한국사＞역사·지리＞고려사'); // ＞ 혼재
    bookRefId = await insertPassage(corpusId, '『宋史』卷487列傳246고려전'); // 『書名』卷 혼재
  });

  it('fetchPending이 혼재 passage를 제외하고 정상만 반환한다', async () => {
    const pending = await fetchPending(conn.client, 'p1', undefined, 'mx');
    expect(pending.map((p) => p.id)).toEqual([normalId]);
  });

  it('countPending이 혼재를 세지 않는다(정상 1건)', async () => {
    expect(await countPending(conn.client, 'p1', 'mx')).toBe(1);
  });

  it('translateCorpus의 attempted가 혼재 제외 수(1)로 나온다', async () => {
    const stats = await translateCorpus(conn, {
      provider: new NamedMock('p1'),
      corpusCode: 'mx',
    });
    expect(stats.attempted).toBe(1);
    expect(stats.translated).toBe(1);
    expect(stats.remaining).toBe(0);
  });

  it('purge가 혼재 done을 삭제하고 정상 done은 보존한다', async () => {
    // 혼재 passage에 과거 오역(done)을 직접 재현: adopt는 필터를 안 거치므로 그대로 사용
    await adopt(conn.client, breadcrumbId, 'sonnet', 'sonnet-x', '오역: 색인문구');
    await adopt(conn.client, bookRefId, 'sonnet', 'sonnet-x', '오역: 서명인용');
    await adopt(conn.client, normalId, 'sonnet', 'sonnet-x', '고려가 사신을 보내 조공하다');

    const purged = await purgeMixedMetadataTranslations(conn.client);
    expect(purged).toBe(2); // 혼재 2건만 삭제

    // 혼재 translation·FTS 소멸
    const mixedTx = await conn.client.execute({
      sql: `SELECT COUNT(*) AS c FROM translation WHERE passage_id IN (?, ?)`,
      args: [breadcrumbId, bookRefId],
    });
    expect(Number(mixedTx.rows[0].c)).toBe(0);
    const mixedFts = await conn.client.execute({
      sql: `SELECT COUNT(*) AS c FROM passage_fts_ko WHERE passage_id IN (?, ?)`,
      args: [breadcrumbId, bookRefId],
    });
    expect(Number(mixedFts.rows[0].c)).toBe(0);

    // 정상 passage의 sonnet 직역·FTS 보존
    const normalTx = await conn.client.execute({
      sql: `SELECT COUNT(*) AS c FROM translation WHERE passage_id = ? AND provider = 'sonnet'`,
      args: [normalId],
    });
    expect(Number(normalTx.rows[0].c)).toBe(1);
    const normalFts = await conn.client.execute({
      sql: `SELECT COUNT(*) AS c FROM passage_fts_ko WHERE passage_id = ?`,
      args: [normalId],
    });
    expect(Number(normalFts.rows[0].c)).toBe(1);
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
