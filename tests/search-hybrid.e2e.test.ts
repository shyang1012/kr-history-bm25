/**
 * @Project: kr-history-bm25
 * @File: search-hybrid.e2e.test.ts
 * @Description: 하이브리드 검색 e2e(동봉 코퍼스·번들 모델). 벡터 탑재 시 의미 arm 동작·정답 포함·정렬·폴백을
 *               구조 계약으로 단언한다. 번들 모델 로컬 로드(다운로드 0, F-03)를 간접 검증. gz·모델 부재 시 skip.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { openBundledDb } from '../src/bundled-db';

const gzPath = fileURLToPath(new URL('../data/history.sqlite.gz', import.meta.url));
const modelPath = fileURLToPath(
  new URL('../models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx', import.meta.url),
);
const ready = existsSync(gzPath) && existsSync(modelPath);

describe.skipIf(!ready)('searchHybrid — e2e(동봉, 오프라인)', () => {
  it('낙랑(한글) 하이브리드 — 의미 arm 동작 + 樂浪 정답 포함', async () => {
    const db = await openBundledDb();
    const result = await db.searchHybrid('낙랑', { limit: 20 });
    expect(result.query).toBe('낙랑');
    expect(result.semantic).toBe(true); // 벡터 탑재 확인
    expect(result.hits.length).toBeGreaterThan(0);
    // 한글 독음 '낙랑' → 사전+벡터로 한자 樂浪 원문에 도달
    expect(result.hits.some((h) => h.textHan.includes('樂浪'))).toBe(true);
    // 융합 점수 내림차순
    const scores = result.hits.map((h) => h.score);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
    db.close();
  }, 90000);

  it('semantic=false면 코어(BM25+사전)로 폴백', async () => {
    const db = await openBundledDb();
    const result = await db.searchHybrid('樂浪', { limit: 10, semantic: false });
    expect(result.semantic).toBe(false);
    expect(result.hits.length).toBeGreaterThan(0);
    db.close();
  }, 30000);

  it('한자 정확 질의도 결과 반환', async () => {
    const db = await openBundledDb();
    const result = await db.searchHybrid('赫居世', { limit: 10 });
    expect(result.hits.length).toBeGreaterThan(0);
    expect(result.hits.some((h) => h.textHan.includes('赫居世'))).toBe(true);
    db.close();
  }, 90000);
});
