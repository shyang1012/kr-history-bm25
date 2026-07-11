/**
 * @Project: kr-history-bm25
 * @File: search-by-reading.test.ts
 * @Description: 독음(reading-aware) 검색 — 채택 독음 역매칭 + 이표기 확장 + 한자 BM25 병합 검증.
 *               단위(:memory:)는 entity·entity_reading 시드로 매칭 로직을, e2e는 동봉 코퍼스로
 *               실사용 반환값(surfaces·hits·matches)을 검증한다.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createDbConnection, type DbConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { adoptReading } from '../src/reading/reading-store';
import { searchByReading, readingDisplay } from '../src/search/search-by-reading';
import { openBundledDb } from '../src/bundled-db';

describe('readingDisplay — reading_type → 표시 메타 파생', () => {
  it('original → 대표음(사전 표제음)', () => {
    expect(readingDisplay('original')).toEqual({
      displayRole: 'dictionary_headword',
      label: '대표음(사전 표제음)',
    });
  });

  it('conventional → 관용 독음', () => {
    expect(readingDisplay('conventional')).toEqual({
      displayRole: 'conventional_reading',
      label: '관용 독음',
    });
  });
});

describe('searchByReading — 단위(:memory:)', () => {
  let conn: DbConnection;
  let entityId: number;

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
    const inserted = await conn.client.execute({
      sql: 'INSERT INTO entity (type, surface) VALUES (?, ?)',
      args: ['이름', '姜邯贊'],
    });
    entityId = Number(inserted.lastInsertRowid);
    await adoptReading(conn.client, {
      entityId,
      reading: '강한찬',
      readingType: 'original',
      source: 'synth',
      status: 'confirmed',
      confidence: 100,
    });
    await adoptReading(conn.client, {
      entityId,
      reading: '강감찬',
      readingType: 'conventional',
      source: 'dict',
      status: 'auto_confirmed',
      confidence: 50,
    });
  });

  it('관용 독음(강감찬)으로 역매칭 — surfaces에 姜邯贊 포함, matches에 대표음/관용 병기', async () => {
    const result = await searchByReading(conn.client, '강감찬');
    expect(result.query).toBe('강감찬');
    expect(result.surfaces).toContain('姜邯贊');
    expect(result.matches).toHaveLength(1);
    const [match] = result.matches;
    expect(match.entityId).toBe(entityId);
    expect(match.surface).toBe('姜邯贊');
    expect(match.type).toBe('이름');
    expect(match.original).toBe('강한찬');
    expect(match.conventional).toBe('강감찬');
    expect(match.originalSource).toBe('synth');
  });

  it('대표음(강한찬)으로도 역매칭된다', async () => {
    const result = await searchByReading(conn.client, '강한찬');
    expect(result.surfaces).toContain('姜邯贊');
    expect(result.matches[0]?.conventional).toBe('강감찬');
  });

  it('매칭 없는 독음은 빈 결과를 반환한다', async () => {
    const result = await searchByReading(conn.client, '존재하지않는독음');
    expect(result.matches).toEqual([]);
    expect(result.surfaces).toEqual([]);
    expect(result.hits).toEqual([]);
  });
});

const gzPath = fileURLToPath(new URL('../data/history.sqlite.gz', import.meta.url));
const hasBundle = existsSync(gzPath);
const workDir = mkdtempSync(join(tmpdir(), 'krh-reading-'));

afterAll(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* 임시폴더 정리 실패 무시 */
  }
});

describe.skipIf(!hasBundle)('searchByReading — e2e(동봉 코퍼스)', () => {
  it('강감찬 — 관용 독음으로 姜邯贊을 찾아 원문 검색한다(간자체 병기 포함)', async () => {
    const db = await openBundledDb({ targetDir: workDir });
    const result = await db.searchByReading('강감찬');
    expect(result.surfaces).toContain('姜邯贊');
    expect(result.hits.length).toBeGreaterThan(0);
    const match = result.matches.find((m) => m.surface === '姜邯贊');
    expect(match?.conventional).toBe('강감찬');
    // 원문 surface는 불변, 간자체는 별도 병기(贊 → 赞)
    expect(match?.simplified).toBe('姜邯赞');
    db.close();
  });

  it('금유신 — 독음 역매칭으로 金庾信을 찾는다', async () => {
    const db = await openBundledDb({ targetDir: workDir });
    const result = await db.searchByReading('금유신');
    expect(result.surfaces).toContain('金庾信');
    db.close();
  });
});
