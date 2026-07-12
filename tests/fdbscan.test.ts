/**
 * @Project: kr-history-bm25
 * @File: fdbscan.test.ts
 * @Description: FDBSCAN 코어(퍼지 밀도 군집) 단위 검증 — 불변식 중심. 특징공간 무관(sim 함수 주입).
 *               경계 분할 소속도·노이즈·고립점·분모0·단일군집·대칭경계·결정론성을 각각 고정한다.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { describe, it, expect } from 'vitest';
import { fdbscan } from '../src/search/fdbscan';

/** 인접 유사도 맵(대칭)에서 sim 함수를 만든다. 미지정 쌍은 0. self는 참조 안 됨(코어가 self 제외). */
function simFrom(edges: Record<string, number>): (a: string, b: string) => number {
  return (a, b) => edges[`${a}|${b}`] ?? edges[`${b}|${a}`] ?? 0;
}

/** 소속도를 {clusterId: membership}로 평탄화(검증 편의) */
function memOf(r: ReturnType<typeof fdbscan>, id: string): Record<number, number> {
  const out: Record<number, number> = {};
  for (const m of r.memberships.get(id) ?? []) {
    out[m.clusterId] = m.membership;
  }
  return out;
}

describe('fdbscan 코어 — 불변식', () => {
  it('두 군집 + 경계점 분할 소속도(합=1)', () => {
    // 군집A={a1,a2}, 군집B={b1,b2}, 경계 x가 a1·b1에 약하게 연결
    const sim = simFrom({
      'a1|a2': 0.9,
      'b1|b2': 0.9,
      'x|a1': 0.3,
      'x|b1': 0.1,
    });
    const r = fdbscan(['a1', 'a2', 'b1', 'b2', 'x'], sim, { simMin: 0.05, muMin: 0.5 });
    // a1,a2,b1,b2는 코어(ρ=0.9≥0.5), x는 비코어(ρ=0.4<0.5)
    expect(r.core.has('a1')).toBe(true);
    expect(r.core.has('x')).toBe(false);
    expect(r.clusters.length).toBe(2);
    // x는 두 군집에 분할 소속(0.3 vs 0.1 → 0.75/0.25), 합=1
    const mx = memOf(r, 'x');
    const vals = Object.values(mx);
    expect(vals.length).toBe(2);
    expect(vals.reduce((s, v) => s + v, 0)).toBeCloseTo(1, 6);
    expect(Math.max(...vals)).toBeCloseTo(0.75, 6);
  });

  it('코어 점 membership=1(자기 군집)', () => {
    const sim = simFrom({ 'a1|a2': 0.9 });
    const r = fdbscan(['a1', 'a2'], sim, { simMin: 0.05, muMin: 0.5 });
    expect(r.clusters.length).toBe(1);
    expect(Object.values(memOf(r, 'a1'))).toEqual([1]);
  });

  it('고립점 → 노이즈(코어 아님, 소속도 없음)', () => {
    const sim = simFrom({ 'a1|a2': 0.9 });
    const r = fdbscan(['a1', 'a2', 'iso'], sim, { simMin: 0.05, muMin: 0.5 });
    expect(r.noise).toContain('iso');
    expect(r.memberships.get('iso') ?? []).toEqual([]);
    expect(r.core.has('iso')).toBe(false);
  });

  it('코어 연결 없는 비코어(분모0) → 노이즈', () => {
    // y는 이웃(z)이 있지만 z가 코어가 아니라 코어 연결 없음
    const sim = simFrom({ 'a1|a2': 0.9, 'y|z': 0.2 });
    const r = fdbscan(['a1', 'a2', 'y', 'z'], sim, { simMin: 0.05, muMin: 0.5 });
    expect(r.noise).toEqual(expect.arrayContaining(['y', 'z']));
  });

  it('단일 군집 — 모든 코어 연결', () => {
    const sim = simFrom({ 'a|b': 0.6, 'b|c': 0.6, 'a|c': 0.6 });
    const r = fdbscan(['a', 'b', 'c'], sim, { simMin: 0.05, muMin: 0.5 });
    expect(r.clusters.length).toBe(1);
    expect(r.noise).toEqual([]);
  });

  it('대칭 경계 → 0.5/0.5 분할', () => {
    const sim = simFrom({ 'a1|a2': 0.9, 'b1|b2': 0.9, 'x|a1': 0.2, 'x|b1': 0.2 });
    const r = fdbscan(['a1', 'a2', 'b1', 'b2', 'x'], sim, { simMin: 0.05, muMin: 0.5 });
    const vals = Object.values(memOf(r, 'x'));
    expect(vals.length).toBe(2);
    expect(vals[0]).toBeCloseTo(0.5, 6);
    expect(vals[1]).toBeCloseTo(0.5, 6);
  });

  it('전부 노이즈 — 코어 없음', () => {
    const sim = simFrom({ 'a|b': 0.1 }); // ρ=0.1<0.5 모두 비코어
    const r = fdbscan(['a', 'b'], sim, { simMin: 0.05, muMin: 0.5 });
    expect(r.clusters).toEqual([]);
    expect(r.noise).toEqual(expect.arrayContaining(['a', 'b']));
  });

  it('결정론 — 입력 순서 무관 동일 출력(clusterId·정렬)', () => {
    const sim = simFrom({ 'a1|a2': 0.9, 'b1|b2': 0.9, 'x|a1': 0.3, 'x|b1': 0.1 });
    const p1 = ['a1', 'a2', 'b1', 'b2', 'x'];
    const p2 = ['x', 'b2', 'b1', 'a2', 'a1'];
    const r1 = fdbscan(p1, sim, { simMin: 0.05, muMin: 0.5 });
    const r2 = fdbscan(p2, sim, { simMin: 0.05, muMin: 0.5 });
    expect(r1.clusters).toEqual(r2.clusters);
    expect(r1.noise).toEqual(r2.noise);
    expect(memOf(r1, 'x')).toEqual(memOf(r2, 'x'));
  });
});
