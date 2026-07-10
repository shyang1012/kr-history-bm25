/**
 * @Project: kr-history-bm25
 * @File: conventional.ts
 * @Description: 관용(conventional) 독음 도출 — 확정된 원음(original)을 기반으로 한다.
 *               (a) 표준국어대사전 surface 정확일치 → dict, (b) 없으면 원음에 두음법칙 적용 → rule,
 *               (c) 두음 변화가 없으면 원음 복사(관용=원음) → rule. 관용 레이어 공백을 방지한다.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import { toDueum } from './dueum';

const HAN = /\p{Script=Han}/u;

/** 관용 도출 결과 */
export interface ConventionalResult {
  reading: string;
  source: 'dict' | 'rule';
}

/**
 * 확정된 원음을 관용독음으로 변환한다.
 * @param surface - 고유명사 한자 표기
 * @param originalReading - 확정된 원음 독음
 * @param dict - 표준국어대사전 한자→관용독음 인덱스
 * @returns 관용 독음 + 출처
 */
export function deriveConventional(
  surface: string,
  originalReading: string,
  dict: Map<string, string>,
): ConventionalResult {
  const hit = dict.get(surface);
  if (hit) {
    // 사전 독음 음절 수가 한자 수와 같을 때만 채택 — 훈음('매울신')·인명('드러먼드광')·복합어 오염 배제
    const hanCount = [...surface].filter((ch) => HAN.test(ch)).length;
    if ([...hit].length === hanCount) {
      return { reading: hit, source: 'dict' };
    }
  }
  // 두음법칙 적용 — 변화가 없으면 toDueum이 원본을 그대로 반환(= 원음 복사)
  return { reading: toDueum(originalReading), source: 'rule' };
}
