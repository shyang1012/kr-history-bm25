/**
 * @Project: kr-history-bm25
 * @File: vector-store.test.ts
 * @Description: 벡터 저장소 단위 검증 — int8 양자화/dequant roundtrip(정규화 벡터 손실 허용범위) + vectorRank
 *               cosine top-K·결정론. DB 없이 순수 함수 중심.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { describe, it, expect } from 'vitest';
import { quantizeInt8, dequantizeInt8, vectorRank } from '../src/search/vector-store';

describe('int8 양자화/dequant roundtrip', () => {
  it('정규화 벡터를 오차 ≤ 1/127로 복원', () => {
    const v = Float32Array.from([0.1, -0.5, 0.9, -0.03, 0.42]);
    const back = dequantizeInt8(quantizeInt8(v));
    expect(back.length).toBe(v.length);
    for (let i = 0; i < v.length; i++) {
      expect(Math.abs(back[i]! - v[i]!)).toBeLessThanOrEqual(1 / 127 + 1e-6);
    }
  });

  it('[-1,1] 밖 값은 클램프', () => {
    const back = dequantizeInt8(quantizeInt8(Float32Array.from([2, -3])));
    expect(back[0]).toBeCloseTo(1, 5); // 127/127
    expect(back[1]).toBeCloseTo(-1, 5); // -127/127
  });

  it('roundtrip 후 cosine 방향 보존', () => {
    const a = Float32Array.from([0.6, 0.8]);
    const b = dequantizeInt8(quantizeInt8(a));
    // 거의 동일 방향 → cosine ≈ 1
    let dot = 0,
      na = 0,
      nb = 0;
    for (let i = 0; i < 2; i++) {
      dot += a[i]! * b[i]!;
      na += a[i]! * a[i]!;
      nb += b[i]! * b[i]!;
    }
    expect(dot / (Math.sqrt(na) * Math.sqrt(nb))).toBeGreaterThan(0.999);
  });
});

describe('vectorRank', () => {
  const vecs = new Map<number, Float32Array>([
    [10, Float32Array.from([1, 0])],
    [20, Float32Array.from([0, 1])],
    [30, Float32Array.from([0.7, 0.7])],
  ]);

  it('질의 방향에 가까운 순으로 top-K', () => {
    const ranked = vectorRank(Float32Array.from([1, 0]), vecs, 3);
    expect(ranked[0]).toBe(10); // 완전 일치
    expect(ranked[1]).toBe(30); // 45도
    expect(ranked[2]).toBe(20); // 직교
  });

  it('k로 절단', () => {
    expect(vectorRank(Float32Array.from([1, 0]), vecs, 1)).toEqual([10]);
  });

  it('동일 입력 동일 출력(결정론)', () => {
    const q = Float32Array.from([0.5, 0.5]);
    expect(vectorRank(q, vecs, 3)).toEqual(vectorRank(q, vecs, 3));
  });
});
