/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/grounding.ts
 * @Description: 신규④ Evidence·GroundingChecker(순수 함수) — [id] 인용 접지 + surface 정성 라벨.
 *   finalText의 `[id]` 인용을 offered 근거 집합과 대조해 미접지 id(환각 후보)를 판정하고,
 *   hanSurface(한자 표기)가 원문에 등장하는지 정성 라벨을 낸다. Evidence는 이 파일에만 두며
 *   orchestrator 코어(types.ts/registry.ts)로 누수하지 않는다(R6 격리).
 * @Author: shyang
 * @LastModified: 2026-07-17
 */

/** GroundingChecker에 제공되는 근거 1건 (도구가 조회한 원문 출처). */
export interface Evidence {
  passageId?: number;
  hanSurface: string;
}

/** [id] 인용 접지 판정 결과. */
export interface GroundingReport {
  /** finalText에서 발견된 [id] 인용 (중복 제거). */
  citedIds: number[];
  /** offered에 없는 인용 id (환각 후보). */
  ungroundedIds: number[];
  /** 접지율 — 인용이 없으면 1(공집합 vacuously true). */
  groundedRate: number;
  /** offered의 hanSurface 중 finalText에 실제로 등장한 것 (정성 라벨). */
  surfaceHits: string[];
}

const ID_RE = /\[(\d+)\]/g;

/**
 * finalText의 `[id]` 인용을 offered 근거와 대조해 접지 여부를 판정한다.
 *
 * @param finalText 모델 최종 답변 본문
 * @param offered 도구가 조회해 제공한 근거 목록
 * @returns 인용 접지 판정 + surface 정성 라벨
 */
export function checkGrounding(finalText: string, offered: Evidence[]): GroundingReport {
  const citedIds = [
    ...new Set([...finalText.matchAll(ID_RE)].map((m) => Number(m[1] ?? NaN))),
  ].filter((id) => !Number.isNaN(id));
  const offeredIds = new Set(
    offered.map((e) => e.passageId).filter((x): x is number => x !== undefined),
  );
  const ungroundedIds = citedIds.filter((id) => !offeredIds.has(id));
  const groundedRate = citedIds.length
    ? (citedIds.length - ungroundedIds.length) / citedIds.length
    : 1;

  const surfaces = offered.map((e) => e.hanSurface).filter(Boolean);
  const surfaceHits = surfaces.filter((s) => finalText.includes(s));

  return { citedIds, ungroundedIds, groundedRate, surfaceHits: [...new Set(surfaceHits)] };
}
