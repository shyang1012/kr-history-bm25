/**
 * @Project: kr-history-bm25
 * @File: reading.test.ts
 * @Description: 독음 사전(krh-cun) — 스키마(char_reading·entity_reading) + 파이프라인 단계 검증.
 *               원음 1차/관용 주석 이중 레이어, char 단위 검수, adopted partial unique 불변식.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { fileURLToPath } from 'node:url';
import { createDbConnection, type DbConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { toDueum } from '../src/reading/dueum';
import { ingestUnihan } from '../src/reading/ingest-unihan';
import { synthesizeOriginal, type CharCandidate } from '../src/reading/synthesize';
import { deriveConventional } from '../src/reading/conventional';
import { buildDictIndex } from '../src/reading/dict-source';
import { loadCharMap, adoptReading, saveDraft } from '../src/reading/reading-store';
import { type Seeds } from '../src/reading/seed';
import { buildReadings } from '../src/reading/build-readings';
import { exportPendingReadingChars, importReadingChars } from '../src/reading/batch';

const unihanSample = fileURLToPath(
  new URL('./fixtures/unihan-readings-sample.txt', import.meta.url),
);
const stdictSample = fileURLToPath(new URL('./fixtures/stdict-sample.json', import.meta.url));

describe('reading schema (0002-reading)', () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
  });

  it('char_reading·entity_reading 테이블이 생성된다', async () => {
    const t = await conn.client.execute(
      "SELECT name FROM sqlite_master WHERE type='table' AND name IN ('char_reading','entity_reading') ORDER BY name",
    );
    expect(t.rows.map((r) => r.name)).toEqual(['char_reading', 'entity_reading']);
  });

  it('char_reading은 (char, reading) 유니크 — 같은 글자의 복수 독음(다음자)은 허용', async () => {
    await conn.client.execute(
      "INSERT INTO char_reading (char, reading, source, seq, is_dueum) VALUES ('麗','려','unihan_khangul',0,0)",
    );
    // 동일 (char,reading) 중복 → 실패
    await expect(
      conn.client.execute(
        "INSERT INTO char_reading (char, reading, source, seq, is_dueum) VALUES ('麗','려','unihan_khangul',1,0)",
      ),
    ).rejects.toThrow();
    // 다른 reading(두음형)은 허용 → 다음자
    await conn.client.execute(
      "INSERT INTO char_reading (char, reading, source, seq, is_dueum) VALUES ('麗','여','unihan_khangul',1,1)",
    );
    const rows = await conn.client.execute("SELECT COUNT(*) n FROM char_reading WHERE char='麗'");
    expect(Number(rows.rows[0].n)).toBe(2);
  });

  it('entity_reading은 (entity_id, reading_type)당 adopted=1 하나만 허용(partial unique)', async () => {
    // 원음 채택 1건
    await conn.client.execute(
      "INSERT INTO entity_reading (entity_id, reading, reading_type, source, adopted) VALUES (1,'한','original','seed',1)",
    );
    // 같은 개체·타입에 두 번째 adopted=1 → partial unique 위반
    await expect(
      conn.client.execute(
        "INSERT INTO entity_reading (entity_id, reading, reading_type, source, adopted) VALUES (1,'감','original','synth',1)",
      ),
    ).rejects.toThrow();
    // adopted=0 후보는 여러 개 공존 허용
    await conn.client.execute(
      "INSERT INTO entity_reading (entity_id, reading, reading_type, source, adopted) VALUES (1,'감','original','synth',0)",
    );
    const rows = await conn.client.execute(
      "SELECT COUNT(*) n FROM entity_reading WHERE entity_id=1 AND reading_type='original'",
    );
    expect(Number(rows.rows[0].n)).toBe(2);
  });

  it('entity_reading은 원음/관용 두 레이어가 같은 개체에 공존한다', async () => {
    await conn.client.execute(
      "INSERT INTO entity_reading (entity_id, reading, reading_type, source, adopted) VALUES (2,'고리','original','seed',1)",
    );
    await conn.client.execute(
      "INSERT INTO entity_reading (entity_id, reading, reading_type, source, adopted) VALUES (2,'고려','conventional','dict',1)",
    );
    const rows = await conn.client.execute(
      'SELECT reading_type, reading FROM entity_reading WHERE entity_id=2 AND adopted=1 ORDER BY reading_type',
    );
    expect(rows.rows.map((r) => [r.reading_type, r.reading])).toEqual([
      ['conventional', '고려'],
      ['original', '고리'],
    ]);
  });

  it('마이그레이션 재실행은 멱등(이미 적용된 0002는 재적용 안 함)', async () => {
    const second = await runMigrations(conn.client);
    expect(second).toEqual([]);
  });
});

describe('두음법칙(dueum) — 본음 → 관용 방향', () => {
  it('어두 ㄹ + j계 모음 → ㅇ (려→여·리→이·류→유·례→예)', () => {
    expect(toDueum('려')).toBe('여');
    expect(toDueum('리')).toBe('이');
    expect(toDueum('류')).toBe('유');
    expect(toDueum('례')).toBe('예');
  });

  it('어두 ㄹ + 비j계 모음 → ㄴ (락→낙·로→노·릉→능·래→내)', () => {
    expect(toDueum('락')).toBe('낙');
    expect(toDueum('로')).toBe('노');
    expect(toDueum('릉')).toBe('능');
    expect(toDueum('래')).toBe('내');
  });

  it('어두 ㄴ + j계 모음 → ㅇ (녀→여·뇨→요·니→이)', () => {
    expect(toDueum('녀')).toBe('여');
    expect(toDueum('뇨')).toBe('요');
    expect(toDueum('니')).toBe('이');
  });

  it('첫 음절만 적용, 나머지 음절은 유지 (려수→여수·리성→이성)', () => {
    expect(toDueum('려수')).toBe('여수');
    expect(toDueum('리성')).toBe('이성');
  });

  it('두음 대상이 아니면 그대로 (가→가·김→김·이미 두음형 여→여·나→나)', () => {
    expect(toDueum('가')).toBe('가');
    expect(toDueum('김')).toBe('김');
    expect(toDueum('여')).toBe('여');
    expect(toDueum('나')).toBe('나');
  });
});

describe('Unihan ingest (char_reading)', () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
    await ingestUnihan(conn, { readingsPath: unihanSample });
  });

  it('kHangul 독음을 순서(seq)대로 char_reading에 적재한다', async () => {
    const r = await conn.client.execute(
      "SELECT reading, seq, is_dueum FROM char_reading WHERE char='麗' ORDER BY seq",
    );
    expect(r.rows.map((x) => [x.reading, Number(x.seq), Number(x.is_dueum)])).toEqual([
      ['려', 0, 0],
      ['여', 1, 1],
    ]);
  });

  it('두음관계가 아닌 진짜 다음자는 둘 다 is_dueum=0 (邯 감/한)', async () => {
    const r = await conn.client.execute(
      "SELECT reading, is_dueum FROM char_reading WHERE char='邯' ORDER BY seq",
    );
    expect(r.rows.map((x) => [x.reading, Number(x.is_dueum)])).toEqual([
      ['감', 0],
      ['한', 0],
    ]);
  });

  it('단일독음은 1행 (高 고)', async () => {
    const r = await conn.client.execute("SELECT reading FROM char_reading WHERE char='高'");
    expect(r.rows.map((x) => x.reading)).toEqual(['고']);
  });

  it('麟은 린(본음)·인(두음형)으로 태깅된다', async () => {
    const r = await conn.client.execute(
      "SELECT reading, is_dueum FROM char_reading WHERE char='麟' ORDER BY seq",
    );
    expect(r.rows.map((x) => [x.reading, Number(x.is_dueum)])).toEqual([
      ['린', 0],
      ['인', 1],
    ]);
  });

  it('kHangul 외 필드(kDefinition 등)는 무시한다', async () => {
    const r = await conn.client.execute('SELECT COUNT(*) n FROM char_reading');
    // 麗2 + 邯2 + 高1 + 麟2 + 李2 + 姜1 + 鄭1 + 趾1 = 12
    expect(Number(r.rows[0].n)).toBe(12);
  });
});

describe('원음 합성(synthesize)', () => {
  const charMap = new Map<string, CharCandidate[]>([
    ['高', [{ reading: '고', seq: 0, isDueum: 0 }]],
    [
      '麗',
      [
        { reading: '려', seq: 0, isDueum: 0 },
        { reading: '여', seq: 1, isDueum: 1 },
      ],
    ],
    [
      '麟',
      [
        { reading: '린', seq: 0, isDueum: 0 },
        { reading: '인', seq: 1, isDueum: 1 },
      ],
    ],
    [
      '邯',
      [
        { reading: '감', seq: 0, isDueum: 0 },
        { reading: '한', seq: 1, isDueum: 0 },
      ],
    ],
    ['鄭', [{ reading: '정', seq: 0, isDueum: 0 }]],
    ['趾', [{ reading: '지', seq: 0, isDueum: 0 }]],
    ['姜', [{ reading: '강', seq: 0, isDueum: 0 }]],
  ]);

  it('단일·두음 글자만이면 본음(비두음)을 합성하고 확정한다 (高麗→고려)', () => {
    const r = synthesizeOriginal('高麗', charMap);
    expect(r.reading).toBe('고려');
    expect(r.confirmed).toBe(true);
    expect(r.reviewChars).toEqual([]);
  });

  it('본음(린) 확정 — 鄭麟趾→정린지', () => {
    const r = synthesizeOriginal('鄭麟趾', charMap);
    expect(r.reading).toBe('정린지');
    expect(r.confirmed).toBe(true);
  });

  it('진짜 다음자(邯 감/한, 비두음 2개) 포함이면 미확정 + reviewChars', () => {
    const r = synthesizeOriginal('姜邯', charMap);
    expect(r.confirmed).toBe(false);
    expect(r.reviewChars).toContain('邯');
  });

  it('희귀자(맵에 없는 한자) 포함이면 미확정 + reviewChars, 원 한자는 유지', () => {
    const r = synthesizeOriginal('高臃', charMap);
    expect(r.confirmed).toBe(false);
    expect(r.reviewChars).toContain('臃');
    expect(r.reading).toBe('고臃');
  });
});

describe('표준국어대사전 인덱스(dict-source)', () => {
  it('JSON에서 한자→관용독음 인덱스를 구축하고 숫자접미사를 제거한다', () => {
    const idx = buildDictIndex([stdictSample]);
    expect(idx.get('金庾信')).toBe('김유신');
    expect(idx.get('高麗')).toBe('고려'); // '고려01' → '고려'
  });

  it('한자 표기가 없는(고유어) 항목은 인덱스에 넣지 않는다', () => {
    const idx = buildDictIndex([stdictSample]);
    expect(idx.size).toBe(2);
  });
});

describe('관용 도출(conventional) — 확정된 원음 기반', () => {
  const dict = new Map([
    ['金庾信', '김유신'],
    ['高麗', '고려'],
  ]);

  it('(a) 사전 정확일치 → dict', () => {
    expect(deriveConventional('金庾信', '금유신', dict)).toEqual({
      reading: '김유신',
      source: 'dict',
    });
  });

  it('(b) 사전 없고 두음 변화 있으면 → rule(두음 적용, 려수→여수)', () => {
    expect(deriveConventional('麗水', '려수', new Map())).toEqual({
      reading: '여수',
      source: 'rule',
    });
  });

  it('(c) 사전 없고 두음 변화 없으면 → rule(원음 복사, 금성)', () => {
    expect(deriveConventional('金城', '금성', new Map())).toEqual({
      reading: '금성',
      source: 'rule',
    });
  });

  it('사전 독음 음절 수가 surface 한자 수와 다르면 dict 무시(훈음·인명 오염 배제, 辛→신)', () => {
    const d = new Map([
      ['辛', '매울신'], // 훈음 오염(3음절 vs 1자)
      ['光', '드러먼드광'], // 인명 오염(5음절 vs 1자)
    ]);
    expect(deriveConventional('辛', '신', d)).toEqual({ reading: '신', source: 'rule' });
    expect(deriveConventional('光', '광', d)).toEqual({ reading: '광', source: 'rule' });
  });

  it('음절 수가 일치하면 dict 채택(鄭麟趾→정인지)', () => {
    const d = new Map([['鄭麟趾', '정인지']]);
    expect(deriveConventional('鄭麟趾', '정린지', d)).toEqual({
      reading: '정인지',
      source: 'dict',
    });
  });
});

describe('reading-store (저장소·채택 게이트)', () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
    await ingestUnihan(conn, { readingsPath: unihanSample });
  });

  it('loadCharMap — char_reading을 char→후보 Map으로 로드한다', async () => {
    const m = await loadCharMap(conn.client);
    expect(m.get('麗')?.map((c) => c.reading)).toEqual(['려', '여']);
    expect(m.get('高')?.length).toBe(1);
  });

  it('saveDraft — 미확정 후보를 adopted=0으로 저장한다', async () => {
    await saveDraft(conn.client, {
      entityId: 10,
      reading: '강감',
      readingType: 'original',
      source: 'synth',
      status: 'draft',
      confidence: 1,
    });
    const r = await conn.client.execute(
      "SELECT reading, adopted, status FROM entity_reading WHERE entity_id=10 AND reading_type='original'",
    );
    expect(r.rows[0].reading).toBe('강감');
    expect(Number(r.rows[0].adopted)).toBe(0);
    expect(r.rows[0].status).toBe('draft');
  });

  it('adoptReading — 후보를 채택하고, 재채택 시 이전 채택을 해제한다(멱등 partial unique)', async () => {
    await adoptReading(conn.client, {
      entityId: 20,
      reading: '감',
      readingType: 'original',
      source: 'synth',
      status: 'draft',
      confidence: 1,
    });
    let r = await conn.client.execute(
      "SELECT reading FROM entity_reading WHERE entity_id=20 AND reading_type='original' AND adopted=1",
    );
    expect(r.rows.map((x) => x.reading)).toEqual(['감']);

    // 학술시드로 재채택 → 이전(synth) 해제, seed 채택
    await adoptReading(conn.client, {
      entityId: 20,
      reading: '한',
      readingType: 'original',
      source: 'seed',
      status: 'seeded',
      confidence: 100,
    });
    r = await conn.client.execute(
      "SELECT reading FROM entity_reading WHERE entity_id=20 AND reading_type='original' AND adopted=1",
    );
    expect(r.rows.map((x) => x.reading)).toEqual(['한']);

    // 두 후보 모두 이력으로 남는다(synth adopted=0, seed adopted=1)
    const all = await conn.client.execute(
      "SELECT COUNT(*) n FROM entity_reading WHERE entity_id=20 AND reading_type='original'",
    );
    expect(Number(all.rows[0].n)).toBe(2);
  });

  it('원음·관용 레이어는 독립적으로 각각 채택된다', async () => {
    await adoptReading(conn.client, {
      entityId: 30,
      reading: '고리',
      readingType: 'original',
      source: 'seed',
      status: 'seeded',
      confidence: 100,
    });
    await adoptReading(conn.client, {
      entityId: 30,
      reading: '고려',
      readingType: 'conventional',
      source: 'dict',
      status: 'auto_confirmed',
      confidence: 50,
    });
    const r = await conn.client.execute(
      'SELECT reading_type, reading FROM entity_reading WHERE entity_id=30 AND adopted=1 ORDER BY reading_type',
    );
    expect(r.rows.map((x) => [x.reading_type, x.reading])).toEqual([
      ['conventional', '고려'],
      ['original', '고리'],
    ]);
  });
});

describe('buildReadings — 파이프라인 통합(원음 확정 → 관용 도출)', () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
    await ingestUnihan(conn, { readingsPath: unihanSample });
    await conn.client.executeMultiple(
      "INSERT INTO entity (type, surface) VALUES ('국명','高麗'),('이름','鄭麟趾'),('이름','姜邯')",
    );
    const charMap = await loadCharMap(conn.client);
    const dict = new Map([['高麗', '고려']]);
    const seeds: Seeds = {
      charSeeds: new Map([['邯', { original: '한', note: '邯鄲 한단' }]]),
      surfaceSeeds: new Map([['高麗', { original: '고리', note: '국명 고음' }]]),
    };
    await buildReadings(conn, { charMap, dict, seeds });
  });

  const adopted = async (
    surface: string,
    type: string,
  ): Promise<{ reading: string; source: string } | null> => {
    const r = await conn.client.execute({
      sql: `SELECT r.reading, r.source FROM entity e
              JOIN entity_reading r ON r.entity_id = e.id AND r.adopted = 1 AND r.reading_type = ?
             WHERE e.surface = ?`,
      args: [type, surface],
    });
    const row = r.rows[0];
    return row ? { reading: String(row.reading), source: String(row.source) } : null;
  };

  it('surface 시드가 원음을 확정한다 (高麗 → 원음 고리, seed)', async () => {
    expect(await adopted('高麗', 'original')).toEqual({ reading: '고리', source: 'seed' });
  });

  it('char 시드가 개체에 전파된다 (邯=한 → 姜邯 원음 강한)', async () => {
    expect(await adopted('姜邯', 'original')).toEqual({ reading: '강한', source: 'synth' });
  });

  it('본음 자동확정 (鄭麟趾 → 원음 정린지)', async () => {
    expect(await adopted('鄭麟趾', 'original')).toEqual({ reading: '정린지', source: 'synth' });
  });

  it('관용 도출 — 사전 일치(高麗 → 관용 고려, dict)', async () => {
    expect(await adopted('高麗', 'conventional')).toEqual({ reading: '고려', source: 'dict' });
  });

  it('has_variant — 원음≠관용 (高麗 고리/고려)', async () => {
    const r = await conn.client.execute(`
      SELECT o.reading AS orig, c.reading AS conv
        FROM entity e
        JOIN entity_reading o ON o.entity_id=e.id AND o.adopted=1 AND o.reading_type='original'
        JOIN entity_reading c ON c.entity_id=e.id AND c.adopted=1 AND c.reading_type='conventional'
       WHERE e.surface='高麗'`);
    expect(r.rows[0].orig).toBe('고리');
    expect(r.rows[0].conv).toBe('고려');
    expect(r.rows[0].orig).not.toBe(r.rows[0].conv);
  });
});

describe('char 단위 검수 배치(batch)', () => {
  let conn: DbConnection;

  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
    await ingestUnihan(conn, { readingsPath: unihanSample });
    await conn.client.executeMultiple(
      "INSERT INTO entity (type, surface) VALUES ('이름','姜邯'),('국명','高麗')",
    );
  });

  it('exportPendingReadingChars — 진짜 다음자만 검수 대상으로 낸다(단일·두음관계 제외)', async () => {
    const e = await exportPendingReadingChars(conn);
    const chars = e.chars.map((c) => c.char);
    expect(chars).toContain('邯'); // 감/한 진짜 다음자
    expect(chars).not.toContain('高'); // 단일독음
    expect(chars).not.toContain('麗'); // 려(본음)/여(두음) — 비두음 1개
    expect(chars).not.toContain('姜'); // 단일독음
    // 邯 후보 목록 제공
    const han = e.chars.find((c) => c.char === '邯');
    expect(han?.reason).toBe('polyphone');
    expect(han?.candidates).toEqual(expect.arrayContaining(['감', '한']));
  });

  it('importReadingChars — llm 확정을 저장하고 재export에서 제외한다(resume)', async () => {
    const stats = await importReadingChars(conn, [
      { char: '邯', reading: '한', status: 'verified' },
    ]);
    expect(stats.imported).toBe(1);
    const after = await exportPendingReadingChars(conn);
    expect(after.chars.map((c) => c.char)).not.toContain('邯');
  });

  it('확정된 char는 이후 buildReadings에서 원음으로 쓰인다 (邯=한 → 姜邯 강한)', async () => {
    const charMap = await loadCharMap(conn.client);
    const seeds: Seeds = { charSeeds: new Map(), surfaceSeeds: new Map() };
    await buildReadings(conn, { charMap, dict: new Map(), seeds });
    const r = await conn.client.execute(
      "SELECT r.reading FROM entity e JOIN entity_reading r ON r.entity_id=e.id AND r.adopted=1 AND r.reading_type='original' WHERE e.surface='姜邯'",
    );
    expect(r.rows[0]?.reading).toBe('강한');
  });

  it('failed 결과는 저장하지 않고 카운트한다', async () => {
    const stats = await importReadingChars(conn, [{ char: '臃', reading: '', status: 'failed' }]);
    expect(stats.failed).toBe(1);
    expect(stats.imported).toBe(0);
  });
});
