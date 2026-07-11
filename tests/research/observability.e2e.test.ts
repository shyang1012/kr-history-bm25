/**
 * @Project: kr-history-bm25
 * @File: observability.e2e.test.ts
 * @Description: 연구 프레임워크 Part B 실사용 관찰의 회귀 안전망(krh-8qi). 동봉 코퍼스 기반
 *               characterization test — 역사적 '결론'이 아니라 도구의 '관찰 가능성'만 고정한다.
 *               벡터·RRF·FDBSCAN(알고리즘 진화)·직역 확대(보조 인덱스 성장) 시 기존 발견 가능성이
 *               깨지지 않았는지 지킨다. data/history.sqlite.gz 있을 때만 실행.
 *
 *               🔴 박는다: 존재성·사서 공존·explicit alias 원문 역추적·복수 node·공기 이웃·부재(대조군).
 *               🔴 안 박는다: 정확한 건수·nodeId·점수(BM25 raw)·순위 — 코퍼스/알고리즘 변경에 취약(=결론 고정).
 *
 *               주의: cluster(surface)는 entity.surface 완전일치 룩업(엔티티 추출 결과 의존)이라
 *               searchHan 전문검색과 메커니즘이 다르다. 표기 확장 시 유의.
 *
 *               이중 안전망 ②(TODO): 고려사(kr)·한국고대사료집성(ko) 직역 완성 시, 아래 대조군 표기의
 *               searchKo를 '부재 단언 → 재현 단언'으로 전환해 보조 인덱스 성장 회귀를 잡는다.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { openBundledDb } from '../../src/bundled-db';
import type { HistoryDb } from '../../src/history-db';

const gzPath = fileURLToPath(new URL('../../data/history.sqlite.gz', import.meta.url));
const hasBundle = existsSync(gzPath);
const workDir = mkdtempSync(join(tmpdir(), 'krh-research-e2e-'));

let db: HistoryDb;

describe.skipIf(!hasBundle)('research observability — Part B 회귀 (동봉 코퍼스)', () => {
  beforeAll(async () => {
    db = await openBundledDb({ targetDir: workDir });
  });

  afterAll(() => {
    try {
      db?.close();
      rmSync(workDir, { recursive: true, force: true });
    } catch {
      /* Windows sqlite 락 — 임시폴더 정리 실패 무시 */
    }
  });

  it('浿水 — 서로 다른 사서·시대 문맥이 공존한다(단일 수계로 강제 통합되지 않음)', async () => {
    // limit≥20 유지: 낮추면 사서 공존 단언이 취약해짐(F-Q2)
    const hits = await db.searchHan('浿水', { limit: 20 });
    expect(hits.length).toBeGreaterThan(0);
    const corpora = new Set(hits.map((h) => h.corpusCode));
    // 삼국사기(sg)·삼국유사(sy) 둘 다 등장 → 복수 시대·문맥
    expect(corpora.has('sg')).toBe(true);
    expect(corpora.has('sy')).toBe(true);
  });

  it('慈悲嶺=岊嶺 — explicit alias 근거가 원문으로 역추적된다', async () => {
    // 사서가 직접 명시한 이명(卽慈悲嶺)의 원문을 한자 인덱스로 되짚을 수 있어야 한다
    const hits = await db.searchHan('卽慈悲嶺', { limit: 20 });
    expect(hits.length).toBeGreaterThan(0);
    // 같은 본문에 두 표기가 함께 존재 → 동일 지명 관계의 원문 근거
    const evidence = hits.find((h) => h.textHan.includes('慈悲嶺') && h.textHan.includes('岊嶺'));
    expect(evidence).toBeDefined();
  });

  it('隴西 — 단일 의미로 강제 통합되지 않는다(복수 문맥 관찰 가능)', async () => {
    const hits = await db.searchHan('隴西', { limit: 20 });
    expect(hits.length).toBeGreaterThan(0);
    // 서로 다른 기사(node) ≥ 2 → 행정구역·본관·별호 등 복수 용례 공존
    const distinctNodes = new Set(hits.map((h) => h.nodeId));
    expect(distinctNodes.size).toBeGreaterThanOrEqual(2);
  });

  it('大同江 — 西京과의 기능 관계가 공기 군집으로 역추적된다', async () => {
    const hits = await db.searchHan('大同江', { limit: 20 });
    expect(hits.length).toBeGreaterThan(0);
    // cluster(entity.surface 완전일치)로 西京이 공기 이웃에 존재 → 도성 근접 기능 관계
    const neighbors = await db.cluster('大同江', { limit: 50 });
    expect(neighbors.some((n) => n.surface === '西京')).toBe(true);
  });

  it('직역 미완 표기는 한자 인덱스로만 잡힌다 — 대조군(trust-principle)', async () => {
    // kr(고려사)·ko(한국고대사료집성)는 직역 미완 → 직역 보조 인덱스(searchKo)에 부재
    expect((await db.searchKo('慈悲嶺', { limit: 5 })).length).toBe(0);
    expect((await db.searchKo('隴西', { limit: 5 })).length).toBe(0);
    // 반면 직역 완료 사서(sg/sy)의 표기는 searchKo에서도 재현된다 → 대조 성립
    expect((await db.searchKo('浿水', { limit: 5 })).length).toBeGreaterThan(0);
  });
});
