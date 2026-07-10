/**
 * @Project: kr-history-bm25
 * @File: synthesize.ts
 * @Description: 원음(original) 글자합성 — surface의 각 한자를 char_reading의 본음(비두음)으로 합성한다.
 *               단일·두음 글자만이면 확정(confirmed), 진짜 다음자(비두음 2개+)·희귀자(맵 부재)가 있으면
 *               미확정으로 두고 그 글자를 reviewChars(LLM 검수 큐)로 반환한다.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */

/** char_reading 후보 1건 */
export interface CharCandidate {
  reading: string;
  seq: number;
  isDueum: number;
  /** 출처 · 'unihan_khangul' | 'llm' 등. seq<0(=llm 검수 확정)은 본음 최우선 */
  source?: string;
}

/** 원음 합성 결과 */
export interface SynthResult {
  /** 합성 독음(미확정 글자는 원 한자를 유지한 임시 초안) */
  reading: string;
  /** 전 글자 본음 확정 여부 */
  confirmed: boolean;
  /** LLM 검수 필요 글자(진짜 다음자·희귀자) */
  reviewChars: string[];
}

const HAN = /\p{Script=Han}/u;

/**
 * surface를 char 본음으로 합성해 원음 초안을 만든다.
 * @param surface - 고유명사 한자 표기
 * @param charMap - char → 후보 독음 목록
 * @returns 합성 결과(reading·confirmed·reviewChars)
 */
export function synthesizeOriginal(
  surface: string,
  charMap: Map<string, CharCandidate[]>,
): SynthResult {
  const parts: string[] = [];
  const reviewChars: string[] = [];
  let confirmed = true;

  for (const ch of surface) {
    if (!HAN.test(ch)) {
      parts.push(ch);
      continue;
    }
    const cands = charMap.get(ch);
    if (!cands || cands.length === 0) {
      // 희귀자 — 원 한자 유지, 미확정
      parts.push(ch);
      reviewChars.push(ch);
      confirmed = false;
      continue;
    }
    const bon = cands.filter((c) => c.isDueum === 0).sort((a, b) => a.seq - b.seq);
    const primary = bon[0];
    if (bon.length === 1 && primary) {
      parts.push(primary.reading);
    } else if (bon.length === 0) {
      // 비두음 본음이 없음(이례) — 첫 후보를 임시로, 미확정
      const first = [...cands].sort((a, b) => a.seq - b.seq)[0];
      parts.push(first ? first.reading : ch);
      reviewChars.push(ch);
      confirmed = false;
    } else if (primary) {
      // 진짜 다음자 — 첫 본음을 임시 초안으로, 미확정(draft)
      parts.push(primary.reading);
      reviewChars.push(ch);
      confirmed = false;
    }
  }

  return { reading: parts.join(''), confirmed, reviewChars };
}
