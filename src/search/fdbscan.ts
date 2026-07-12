/**
 * @Project: kr-history-bm25
 * @File: fdbscan.ts
 * @Description: FDBSCAN(퍼지 밀도 군집) 코어 — 특징공간 무관(sim 함수 주입). 하드 DBSCAN을 퍼지화:
 *               soft 밀도(이웃 유사도 합)로 코어 판정, 코어 연결요소=군집, 비코어는 fuzzy border 소속도로
 *               여러 군집에 분할 소속(지명 이동·동음이의 보존). 결정론적(정렬 순회, 랜덤초기화 없음).
 * @Author: shyang
 * @LastModified: 2026-07-11
 */

/** FDBSCAN 파라미터 */
export interface FdbscanParams {
  /** soft eps — 이웃 편입 유사도 하한 */
  simMin: number;
  /** 코어 밀도 하한(soft MinPts) */
  muMin: number;
}

/** 한 점의 군집 소속도 1건 */
export interface FdbscanMembership {
  /** 군집 id(정렬된 최소 멤버 기준 canonical 순번) */
  clusterId: number;
  /** 소속도(코어=1, 경계=분할, 합=1) */
  membership: number;
}

/** FDBSCAN 결과 */
export interface FdbscanResult {
  /** 군집 id 목록(오름차순) */
  clusters: number[];
  /** 점 id → 소속도 목록(정렬). 노이즈는 빈 배열/미포함 */
  memberships: Map<string, FdbscanMembership[]>;
  /** 노이즈 점 id(정렬) */
  noise: string[];
  /** 코어 점 id 집합 */
  core: Set<string>;
}

/**
 * 퍼지 밀도 군집을 계산한다. sim(a,b)∈[0,1] 대칭 가정, self는 참조하지 않는다(코어가 self 제외).
 * @param points - 점 id 목록
 * @param sim - 유사도 함수(a≠b), 유한 [0,1]
 * @param params - simMin·muMin
 * @returns 군집·소속도·노이즈·코어
 */
export function fdbscan(
  points: string[],
  sim: (a: string, b: string) => number,
  params: FdbscanParams,
): FdbscanResult {
  const { simMin, muMin } = params;
  const ids = [...new Set(points)].sort(); // 결정론: 정렬 순회

  // 이웃(self 제외, sim≥simMin) + 밀도 ρ = Σ sim
  const neighbors = new Map<string, { q: string; s: number }[]>();
  const density = new Map<string, number>();
  for (const p of ids) {
    const list: { q: string; s: number }[] = [];
    let rho = 0;
    for (const q of ids) {
      if (q === p) {
        continue;
      }
      const s = sim(p, q);
      if (s >= simMin && s > 0) {
        list.push({ q, s });
        rho += s;
      }
    }
    neighbors.set(p, list);
    density.set(p, rho);
  }

  // 코어: 밀도 ρ≥muMin. 🔴 ρ>0 필수 — muMin≤0이라도 고립점(ρ=0)은 코어가 될 수 없다(노이즈 불변식).
  const core = new Set<string>(
    ids.filter((p) => {
      const rho = density.get(p) ?? 0;
      return rho > 0 && rho >= muMin;
    }),
  );

  // 코어 연결요소 → 군집. 정렬 순회라 clusterId는 최소 멤버 순으로 canonical.
  const clusterOf = new Map<string, number>();
  let nextId = 0;
  for (const p of ids) {
    if (!core.has(p) || clusterOf.has(p)) {
      continue;
    }
    const id = nextId++;
    const stack = [p];
    clusterOf.set(p, id);
    while (stack.length > 0) {
      const cur = stack.pop() as string;
      for (const { q } of neighbors.get(cur) ?? []) {
        if (core.has(q) && !clusterOf.has(q)) {
          clusterOf.set(q, id);
          stack.push(q);
        }
      }
    }
  }

  const clusters = Array.from({ length: nextId }, (_, i) => i);
  const memberships = new Map<string, FdbscanMembership[]>();
  const noise: string[] = [];

  for (const p of ids) {
    if (core.has(p)) {
      memberships.set(p, [{ clusterId: clusterOf.get(p) as number, membership: 1 }]);
      continue;
    }
    // 비코어: 코어 이웃의 유사도를 군집별로 합산 → 정규화(fuzzy border)
    const weight = new Map<number, number>();
    let denom = 0;
    for (const { q, s } of neighbors.get(p) ?? []) {
      const c = clusterOf.get(q);
      if (c === undefined) {
        continue; // 코어 아닌 이웃은 어느 군집에도 기여 안 함
      }
      weight.set(c, (weight.get(c) ?? 0) + s);
      denom += s;
    }
    if (denom <= 0) {
      noise.push(p);
      continue;
    }
    const mems = [...weight.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([clusterId, w]) => ({ clusterId, membership: w / denom }));
    memberships.set(p, mems);
  }

  return { clusters, memberships, noise, core };
}
