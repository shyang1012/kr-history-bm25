/**
 * @Project: kr-history-bm25
 * @File: reading-simplified.test.ts
 * @Description: 간자체 매핑 검증 — Unihan kSimplifiedVariant 적재(char_simplified) + 정자→간자체 변환.
 *               원문(정자)은 불변이고 간자체는 병기 전용임을, 보조평면 간자체는 제외됨을 확인한다.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDbConnection, type DbConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import {
  ingestSimplified,
  loadSimplifiedMap,
  toSimplified,
  loadTraditionalForChars,
  expandSimplifiedToTraditional,
} from '../src/reading/simplified';
import { openBundledDb } from '../src/bundled-db';

describe('toSimplified — 정자→간자체 변환(원문 불변, 병기 전용)', () => {
  it('간자체가 있는 글자는 변환하고 changed=true', () => {
    const map = new Map([
      ['遼', '辽'],
      ['東', '东'],
    ]);
    expect(toSimplified('遼東', map)).toEqual({ simplified: '辽东', changed: true });
  });

  it('간자체가 없으면 정자 유지·changed=false', () => {
    expect(toSimplified('平壤', new Map())).toEqual({ simplified: '平壤', changed: false });
  });

  it('일부만 간자체여도 정자 원문은 훼손 없이 병기 문자열만 생성', () => {
    const map = new Map([['漢', '汉']]);
    expect(toSimplified('漢城', map)).toEqual({ simplified: '汉城', changed: true });
  });

  it('보조평면(U+10000~) 간자체는 지도 검색 비실용이라 제외 — 정자 유지', () => {
    // 浿 → 𬇙(U+2C1D9, 보조평면) 매핑이 있어도 병기하지 않는다
    const map = new Map([['浿', String.fromCodePoint(0x2c1d9)]]);
    expect(toSimplified('浿水', map)).toEqual({ simplified: '浿水', changed: false });
  });
});

describe('ingestSimplified — Unihan kSimplifiedVariant 적재', () => {
  let conn: DbConnection;
  const fixture = fileURLToPath(new URL('./fixtures/unihan-variants-sample.txt', import.meta.url));

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
  });

  afterAll(() => {
    conn.client.close();
  });

  it('kSimplifiedVariant만 char_simplified에 적재하고 변환에 쓴다', async () => {
    const stat = await ingestSimplified(conn, { variantsPath: fixture });
    expect(stat.mappings).toBeGreaterThan(0);
    const map = await loadSimplifiedMap(conn.client);
    // 픽스처: 義(U+7FA9) kSimplifiedVariant 义(U+4E49)
    expect(map.get('義')).toBe('义');
    expect(toSimplified('義', map)).toEqual({ simplified: '义', changed: true });
  });

  it('역방향(간자체→정자) 로드로 질의를 정자로 확장한다', async () => {
    // 픽스처의 義→义 매핑 기반: 간자체 义 질의 → 정자 義 후보
    const revMap = await loadTraditionalForChars(conn.client, ['义']);
    expect(revMap.get('义')).toContain('義');
    const exp = expandSimplifiedToTraditional('义', revMap);
    expect(exp.changed).toBe(true);
    expect(exp.candidates).toContain('義');
    expect(exp.candidates).toContain('义'); // 원 질의 항상 포함
  });
});

describe('expandSimplifiedToTraditional — 간자체 질의 확장(OR)', () => {
  it('각 글자를 정자 후보로 조합하고 원 질의를 포함한다', () => {
    const revMap = new Map<string, string[]>([
      ['辽', ['遼']],
      ['东', ['東']],
    ]);
    const exp = expandSimplifiedToTraditional('辽东', revMap);
    expect(exp.changed).toBe(true);
    expect(exp.candidates).toContain('遼東');
    expect(exp.candidates).toContain('辽东');
  });

  it('다대일 모호 글자는 후보를 모두 낸다(OR, 놓침 없음)', () => {
    const revMap = new Map<string, string[]>([['后', ['後', '后']]]);
    const exp = expandSimplifiedToTraditional('后', revMap);
    expect(exp.candidates).toEqual(expect.arrayContaining(['後', '后']));
  });

  it('간자체가 없으면 원 질의만·changed=false(정자 질의 불변)', () => {
    const exp = expandSimplifiedToTraditional('遼東', new Map());
    expect(exp).toEqual({ candidates: ['遼東'], changed: false });
  });
});

const gzPath = fileURLToPath(new URL('../data/history.sqlite.gz', import.meta.url));

describe.skipIf(!existsSync(gzPath))('searchHan — 간자체 질의 e2e(동봉 코퍼스)', () => {
  it('간자체 辽东으로 검색해도 정자 遼東 원문이 잡힌다', async () => {
    const db = await openBundledDb();
    const exp = await db.traditionalize('辽东');
    expect(exp.changed).toBe(true);
    expect(exp.candidates).toContain('遼東');
    const hits = await db.searchHan('辽东', { limit: 5 });
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => h.textHan.includes('遼東'))).toBe(true);
    db.close();
  });
});
