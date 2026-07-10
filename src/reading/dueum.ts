/**
 * @Project: kr-history-bm25
 * @File: dueum.ts
 * @Description: 두음법칙(頭音法則) — 본음(원음) → 관용독음 변환. 어두 첫 음절에만 적용한다.
 *               ㄹ/ㄴ + j계 모음 → ㅇ, ㄹ + 비j계 모음 → ㄴ. 인명 내부 등 확장 적용은
 *               규칙 밖(dict/seed/llm이 담당)이며 이 함수는 단어 첫 음절 규칙만 다룬다.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */

const HANGUL_BASE = 0xac00;
const HANGUL_LAST = 0xd7a3;
const CHO_R = 5; // 초성 ㄹ
const CHO_N = 2; // 초성 ㄴ
const CHO_O = 11; // 초성 ㅇ
/** j계(y-활음·ㅣ) 중성 index: ㅑㅒㅕㅖㅛㅠㅣ */
const J_MEDIALS = new Set([2, 3, 6, 7, 12, 17, 20]);

/**
 * 본음 독음을 관용독음(두음법칙 적용)으로 변환한다. 첫 음절에만 적용한다.
 * @param reading - 본음 독음(한글 문자열)
 * @returns 두음법칙 적용 결과. 대상이 아니면 원본 그대로.
 */
export function toDueum(reading: string): string {
  if (!reading) {
    return reading;
  }
  const first = reading.codePointAt(0);
  if (first === undefined || first < HANGUL_BASE || first > HANGUL_LAST) {
    return reading;
  }

  const syll = first - HANGUL_BASE;
  const cho = Math.floor(syll / 588);
  const jung = Math.floor((syll % 588) / 28);
  const jong = syll % 28;

  let newCho: number | null = null;
  if (cho === CHO_R) {
    newCho = J_MEDIALS.has(jung) ? CHO_O : CHO_N;
  } else if (cho === CHO_N && J_MEDIALS.has(jung)) {
    newCho = CHO_O;
  }
  if (newCho === null) {
    return reading;
  }

  const converted = HANGUL_BASE + newCho * 588 + jung * 28 + jong;
  return String.fromCodePoint(converted) + reading.slice(1);
}
