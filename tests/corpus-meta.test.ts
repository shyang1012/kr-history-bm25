/**
 * @Project: kr-history-bm25
 * @File: corpus-meta.test.ts
 * @Description: 코퍼스 자기설명(krh-i2o) 회귀 테스트 — 레지스트리 단일 소스·0005 backfill(업그레이드 경로)·
 *               listCorpora 계약. 서버가 「무엇을 담고 있는가」를 선언하지 못해 소비자(LLM)가 출처 성격을
 *               날조한 결함을 막는다. 근거: docs/corpus-self-description-gap-report.md
 * @Author: shyang
 * @LastModified: 2026-08-21
 */
import { describe, it, expect } from 'vitest';
import type { Client } from '@libsql/client';
import { createDbConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { listCorpora } from '../src/corpus/list-corpora';
import { CORPUS_REGISTRY, corpusCodes, describeCorpusCodes } from '../src/corpus/corpus-registry';

/** 코퍼스 1행 + passage n건 + 직역 done m건을 심는다 */
async function seed(
  client: Client,
  spec: { id: number; code: string; name: string; passages: number; translated: number },
): Promise<void> {
  await client.execute({
    sql: 'INSERT INTO corpus (id, code, name, source_dir, ingested_at) VALUES (?, ?, ?, ?, ?)',
    args: [spec.id, spec.code, spec.name, `source/${spec.code}`, '2026-07-08T21:22:22.777Z'],
  });
  for (let i = 0; i < spec.passages; i += 1) {
    const passageId = spec.id * 1000 + i;
    await client.execute({
      sql: `INSERT INTO passage (id, corpus_id, node_id, seq, text_han, han_indexed, char_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [passageId, spec.id, `${spec.code}_001_0010`, i, '卒本川', '卒 本 川', 3],
    });
    if (i < spec.translated) {
      await client.execute({
        sql: `INSERT INTO translation (passage_id, provider, model, text, status, adopted)
              VALUES (?, 'claude', 'claude-sonnet-5', '졸본천', 'done', 1)`,
        args: [passageId],
      });
    }
  }
}

describe('CORPUS_REGISTRY — 코퍼스 설명 단일 소스', () => {
  it('실재하는 코드 5종만 담는다(schema.ts 주석의 ss·ka는 실재하지 않음)', () => {
    expect([...corpusCodes()].sort()).toEqual(['kj', 'ko', 'kr', 'sg', 'sy']);
    expect(corpusCodes()).not.toContain('ss');
    expect(corpusCodes()).not.toContain('ka');
  });

  it('ko(한국고대사료집성)를 1차 사료 발췌·외부 관찰기록으로 선언한다', () => {
    const ko = CORPUS_REGISTRY.ko;
    expect(ko.name).toBe('한국고대사료집성');
    // 실측 오답의 직접 원인 — 모델이 「현대 연구 자료」로 서술했다
    expect(ko.description).toContain('발췌');
    expect(ko.description).toContain('원문');
    expect(ko.description).toContain('외부');
    expect(ko.description).toContain('1차 사료');
  });

  it('사서마다 편찬 형식·관찰 위치를 담는다(corpus-taxonomy 다축)', () => {
    expect(CORPUS_REGISTRY.sg.description).toContain('기전체');
    expect(CORPUS_REGISTRY.kj.description).toContain('편년체');
    expect(CORPUS_REGISTRY.sy.description).toContain('야사');
    expect(CORPUS_REGISTRY.kr.description).toContain('내부');
  });

  it('describeCorpusCodes는 도구 설명용 코드 문자열을 조립한다', () => {
    const hint = describeCorpusCodes([
      { code: 'sg', name: '삼국사기' },
      { code: 'ko', name: '한국고대사료집성' },
    ]);
    expect(hint).toContain('sg=삼국사기');
    expect(hint).toContain('ko=한국고대사료집성');
  });
});

describe('0005-corpus-description 마이그레이션', () => {
  it('corpus에 description 컬럼을 만든다', async () => {
    const { client } = createDbConnection(':memory:');
    const applied = await runMigrations(client);
    expect(applied).toContain('0005-corpus-description');

    const info = await client.execute('PRAGMA table_info(corpus)');
    expect(info.rows.map((r) => String(r.name))).toContain('description');
    client.close();
  });

  it('구 DB(설명 없는 동봉본) 업그레이드 시 기존 행을 backfill한다', async () => {
    const { client } = createDbConnection(':memory:');
    await runMigrations(client);

    // 0.4.0 동봉본 재현 — description 컬럼도 마이그레이션 이력도 없는 상태
    await client.execute("DELETE FROM _migrations WHERE version = '0005-corpus-description'");
    await client.execute('ALTER TABLE corpus DROP COLUMN description');
    await seed(client, { id: 5, code: 'ko', name: '한국고대사료집성', passages: 2, translated: 0 });

    const applied = await runMigrations(client);
    expect(applied).toEqual(['0005-corpus-description']);

    const row = await client.execute("SELECT description FROM corpus WHERE code = 'ko'");
    expect(String(row.rows[0].description)).toContain('발췌');
    client.close();
  });
});

describe('listCorpora', () => {
  it('코드·이름·설명·passage·직역 건수·ingestedAt을 반환한다', async () => {
    const { client } = createDbConnection(':memory:');
    await runMigrations(client);
    await seed(client, { id: 3, code: 'sg', name: '삼국사기', passages: 5, translated: 4 });
    await seed(client, { id: 5, code: 'ko', name: '한국고대사료집성', passages: 3, translated: 0 });

    const corpora = await listCorpora(client);
    const sg = corpora.find((c) => c.code === 'sg');
    expect(sg).toMatchObject({ name: '삼국사기', passageCount: 5, translatedCount: 4 });
    expect(sg?.ingestedAt).toBe('2026-07-08T21:22:22.777Z');
    expect(sg?.description).toContain('기전체');

    const ko = corpora.find((c) => c.code === 'ko');
    expect(ko).toMatchObject({ passageCount: 3, translatedCount: 0 });
    client.close();
  });

  it('레지스트리 순서(사서 연대순)로 정렬한다', async () => {
    const { client } = createDbConnection(':memory:');
    await runMigrations(client);
    await seed(client, { id: 1, code: 'kr', name: '고려사', passages: 1, translated: 0 });
    await seed(client, { id: 3, code: 'sg', name: '삼국사기', passages: 1, translated: 0 });

    const corpora = await listCorpora(client);
    expect(corpora.map((c) => c.code)).toEqual(['sg', 'kr']);
    client.close();
  });

  it('DB 설명이 비어도 레지스트리로 폴백하고, 미등록 코퍼스는 null로 정직하게 둔다', async () => {
    const { client } = createDbConnection(':memory:');
    await runMigrations(client);
    await seed(client, { id: 5, code: 'ko', name: '한국고대사료집성', passages: 1, translated: 0 });
    await seed(client, { id: 9, code: 'xx', name: '사용자 코퍼스', passages: 1, translated: 0 });
    await client.execute('UPDATE corpus SET description = NULL');

    const corpora = await listCorpora(client);
    expect(corpora.find((c) => c.code === 'ko')?.description).toContain('발췌');
    expect(corpora.find((c) => c.code === 'xx')?.description).toBeNull();
    client.close();
  });
});
