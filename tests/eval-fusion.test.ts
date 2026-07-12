/**
 * @Project: kr-history-bm25
 * @File: eval-fusion.test.ts
 * @Description: RRF 융합·코사인 유사도 단위 검증 — 손으로 만든 랭킹·벡터로 기지값·결정론·엣지케이스 고정.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { describe, it, expect } from 'vitest';
import { rrf, cosineSim } from '../src/eval/fusion';

describe('rrf — Reciprocal Rank Fusion', () => {
  it('두 리스트에서 공통 상위 item이 최고점을 받는다', () => {
    // A: [x, y, z], B: [x, z, w] — x는 양쪽 1위
    const fused = rrf([
      ['x', 'y', 'z'],
      ['x', 'z', 'w'],
    ]);
    expect(fused[0]!.item).toBe('x');
    // x = 1/61 + 1/61, z = 1/63 + 1/62, y = 1/62, w = 1/63
    expect(fused[0]!.score).toBeCloseTo(2 / 61, 10);
  });

  it('단일 리스트는 입력 순서를 보존한다', () => {
    const fused = rrf([['a', 'b', 'c']]);
    expect(fused.map((f) => f.item)).toEqual(['a', 'b', 'c']);
  });

  it('동점은 item 문자열 오름차순으로 결정론적 tie-break', () => {
    // b, a는 각각 한 리스트에서 1위 → 동점, 문자열 오름차순 a < b
    const fused = rrf([['b'], ['a']]);
    expect(fused.map((f) => f.item)).toEqual(['a', 'b']);
    expect(fused[0]!.score).toBeCloseTo(fused[1]!.score, 12);
  });

  it('숫자 item(passageId)도 병합된다', () => {
    const fused = rrf([
      [10, 20, 30],
      [30, 10],
    ]);
    // 10 = 1/61 + 1/62, 30 = 1/63 + 1/61, 10 > 30
    expect(fused[0]!.item).toBe(10);
  });

  it('k<=0은 오류', () => {
    expect(() => rrf([['a']], 0)).toThrow();
  });

  it('동일 입력 → 동일 출력(결정론)', () => {
    const input = [
      ['p', 'q', 'r'],
      ['r', 's', 'p'],
    ];
    expect(rrf(input)).toEqual(rrf(input));
  });
});

describe('cosineSim', () => {
  it('동일 방향 벡터는 1', () => {
    expect(cosineSim([1, 2, 3], [2, 4, 6])).toBeCloseTo(1, 10);
  });

  it('직교 벡터는 0', () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0, 10);
  });

  it('반대 방향은 -1', () => {
    expect(cosineSim([1, 1], [-1, -1])).toBeCloseTo(-1, 10);
  });

  it('영벡터는 0(0-division 방어)', () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
  });

  it('차원 불일치는 오류', () => {
    expect(() => cosineSim([1, 2], [1, 2, 3])).toThrow();
  });
});
