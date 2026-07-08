/**
 * @Project: kr-history-bm25
 * @File: tokenizer.ts
 * @Description: 한문 unigram 토큰화 + FTS5 구문(phrase) 질의 생성. 한자 엄격 구분을 위해 글자(codepoint) 단위로 색인한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */

/**
 * CJK(한중일 통합한자 + 확장 영역)에 해당하는 codepoint 인지 판별한다.
 * 대체문자쌍(surrogate pair)로 표현되는 확장 B~F 영역(한국고대사료집성 희귀자)까지 포함한다.
 * @param cp - Unicode code point
 * @returns CJK 한자면 true
 */
export function isCjk(cp: number): boolean {
  return (
    (cp >= 0x3400 && cp <= 0x4dbf) || // CJK Ext A
    (cp >= 0x4e00 && cp <= 0x9fff) || // CJK 기본
    (cp >= 0xf900 && cp <= 0xfaff) || // CJK 호환 한자
    (cp >= 0x20000 && cp <= 0x2ebef) || // CJK Ext B~F
    (cp >= 0x2f800 && cp <= 0x2fa1f) // CJK 호환 확장
  );
}

/**
 * 한문 텍스트를 글자 단위 unigram 토큰열(공백 구분)으로 변환한다.
 * 표점·비CJK 문자는 토큰 구분자로 처리하여 색인에서 제외한다.
 * 예) '卒本川' → '卒 本 川'
 * @param text - 원문 텍스트(표점 포함 가능)
 * @returns 공백으로 구분된 한자 unigram 문자열
 */
export function hanToUnigram(text: string): string {
  const tokens: string[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp !== undefined && isCjk(cp)) {
      tokens.push(ch);
    }
  }
  return tokens.join(' ');
}

/**
 * 검색어(한자열)를 FTS5 구문 질의로 변환한다.
 * 다자 지명은 정확 인접 매칭을 위해 큰따옴표 phrase로 감싼다. 예) '卒本' → '"卒 本"'
 * 한자가 없으면 빈 문자열을 반환한다(질의 스킵 신호).
 * @param term - 사용자 검색어
 * @returns FTS5 MATCH 구문 문자열
 */
export function buildPhraseQuery(term: string): string {
  const unigram = hanToUnigram(term);
  if (unigram.length === 0) {
    return '';
  }
  return `"${unigram}"`;
}
