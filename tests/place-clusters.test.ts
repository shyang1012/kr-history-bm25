/**
 * @Project: kr-history-bm25
 * @File: place-clusters.test.ts
 * @Description: placeClusters 통합 검증 — 공기 ego-network SQL → Jaccard → FDBSCAN → 매핑. 구조 불변식 중심
 *               (seed·scope·params 반영, truncated, 소속도 합, 정렬). 특정 데이터값 하드코딩 지양(F-06).
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createDbConnection, type DbConnection } from '../src/db/client';
import { runMigrations } from '../src/db/migrate';
import { ingestCorpus } from '../src/ingest/ingest-corpus';
import { placeClusters } from '../src/search/place-clusters';
import { openBundledDb } from '../src/bundled-db';

const corpusDir = fileURLToPath(new URL('./fixtures/corpus', import.meta.url));

describe('placeClusters — 통합(:memory:)', () => {
  let conn: DbConnection;
  beforeAll(async () => {
    conn = createDbConnection(':memory:');
    await runMigrations(conn.client);
    await ingestCorpus(conn, { dir: corpusDir, code: 'tt', name: '테스트사서' });
  });

  it('seed·scope·params를 그대로 반영한다', async () => {
    const r = await placeClusters(conn.client, '金城', {
      scope: 'paragraph',
      minCooc: 1,
      simMin: 0.01,
      muMin: 0.01,
      limit: 50,
    });
    expect(r.seed).toBe('金城');
    expect(r.scope).toBe('paragraph');
    expect(r.params).toEqual({ simMin: 0.01, muMin: 0.01, minCooc: 1, limit: 50 });
    expect(typeof r.truncated).toBe('boolean');
    // 金城은 漢城과 동일 문단 공기 → 어딘가(군집 또는 노이즈)에 漢城 등장
    const all = [...r.clusters.flatMap((c) => c.members.map((m) => m.surface)), ...r.noise];
    expect(all).toContain('漢城');
  });

  it('존재하지 않는 seed는 빈 결과', async () => {
    const r = await placeClusters(conn.client, '없는지명XYZ', {});
    expect(r.clusters).toEqual([]);
    expect(r.noise).toEqual([]);
  });
});

const gzPath = fileURLToPath(new URL('../data/history.sqlite.gz', import.meta.url));

describe.skipIf(!existsSync(gzPath))('placeClusters — e2e(동봉, 구조 불변식)', () => {
  it('樂浪 국소 퍼지 군집 — 구조 계약', async () => {
    const db = await openBundledDb();
    const r = await db.placeClusters('樂浪', {
      scope: 'article',
      minCooc: 2,
      simMin: 0.08,
      muMin: 0.3,
    });
    expect(r.seed).toBe('樂浪');
    expect(r.clusters.length).toBeGreaterThan(0);
    for (const c of r.clusters) {
      expect(c.members.length).toBeGreaterThan(0);
      // 소속도: (0,1], 코어=1, 정렬(내림차순)
      for (const m of c.members) {
        expect(m.membership).toBeGreaterThan(0);
        expect(m.membership).toBeLessThanOrEqual(1 + 1e-9);
      }
      const mems = c.members.map((m) => m.membership);
      expect([...mems].sort((a, b) => b - a)).toEqual(mems);
    }
    // 노이즈 정렬
    expect([...r.noise].sort()).toEqual(r.noise);
    db.close();
  });

  it('parameterMode auto — 고정 파라미터가 붕괴하는 희소 seed를 회복(selection 반환)', async () => {
    const db = await openBundledDb();
    const fixed = await db.placeClusters('慈悲嶺', { scope: 'article', parameterMode: 'fixed' });
    const auto = await db.placeClusters('慈悲嶺', { scope: 'article', parameterMode: 'auto' });
    // 희소 seed는 fixed에서 0군집(붕괴) 가능 → auto가 회복
    expect(fixed.clusters.length).toBe(0);
    expect(auto.clusters.length).toBeGreaterThan(0);
    // selection 근거(재현성·투명성)
    expect(auto.selection?.parameterMode).toBe('auto');
    expect(auto.selection?.suggested).toBeDefined();
    expect(auto.selection?.candidateCount).toBe(16);
    db.close();
  });

  it('auto는 결정론적(동일 입력 동일 결과)', async () => {
    const db = await openBundledDb();
    const a1 = await db.placeClusters('鐵嶺', { scope: 'article', parameterMode: 'auto' });
    const a2 = await db.placeClusters('鐵嶺', { scope: 'article', parameterMode: 'auto' });
    expect(a1.params).toEqual(a2.params);
    expect(a1.clusters.length).toBe(a2.clusters.length);
    expect(a1.noise).toEqual(a2.noise);
    db.close();
  });

  it('경계 지명의 소속도 합은 1(분할 소속)', async () => {
    const db = await openBundledDb();
    const r = await db.placeClusters('樂浪', {
      scope: 'article',
      minCooc: 2,
      simMin: 0.08,
      muMin: 0.3,
    });
    // 여러 군집에 걸친 지명(경계)의 소속도 합 검증
    const sum = new Map<string, number>();
    for (const c of r.clusters) {
      for (const m of c.members) {
        sum.set(m.surface, (sum.get(m.surface) ?? 0) + m.membership);
      }
    }
    for (const total of sum.values()) {
      expect(total).toBeCloseTo(Math.round(total), 6); // 코어=1, 경계 분할합=1
    }
    db.close();
  });
});
