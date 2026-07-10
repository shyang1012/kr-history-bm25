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

/** ASCII 영숫자(런으로 유지: '13'·'BC') 판별 */
function isAsciiAlnum(cp: number): boolean {
  return (
    (cp >= 0x30 && cp <= 0x39) || // 0-9
    (cp >= 0x41 && cp <= 0x5a) || // A-Z
    (cp >= 0x61 && cp <= 0x7a) // a-z
  );
}

/**
 * 직역(한국어) 텍스트를 색인용 토큰열로 변환한다.
 * 한글 음절·한자는 글자 단위로, ASCII 영숫자는 런으로 유지한다(조사 결합 극복 — '일식'이 '일식이'를 매칭).
 * 예) '일식이 있었다' → '일 식 이 있 었 다', '金城' → '金 城', 'BC57년' → 'BC 57 년'
 * @param text - 직역 텍스트
 * @returns 공백 구분 토큰 문자열
 */
export function koToUnigram(text: string): string {
  const tokens: string[] = [];
  let run = '';
  const flush = (): void => {
    if (run.length > 0) {
      tokens.push(run);
      run = '';
    }
  };
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === undefined) {
      continue;
    }
    const isHangul = cp >= 0xac00 && cp <= 0xd7a3;
    if (isHangul || isCjk(cp)) {
      flush();
      tokens.push(ch);
    } else if (isAsciiAlnum(cp)) {
      run += ch;
    } else {
      flush();
    }
  }
  flush();
  return tokens.join(' ');
}

/**
 * 직역 검색어를 FTS5 구문 질의로 변환한다(ko 음절 단위).
 * 예) '일식' → '"일 식"', '金城' → '"金 城"'
 * @param term - 사용자 검색어(한국어)
 * @returns FTS5 MATCH 구문 문자열(토큰 없으면 빈 문자열)
 */
export function buildKoPhraseQuery(term: string): string {
  const unigram = koToUnigram(term);
  if (unigram.length === 0) {
    return '';
  }
  return `"${unigram}"`;
}
