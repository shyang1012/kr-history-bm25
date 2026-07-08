/**
 * @Project: kr-history-bm25
 * @File: tokenizer.test.ts
 * @Description: 한문 unigram 토큰화 + FTS5 phrase 질의 테스트
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { describe, it, expect } from 'vitest';
import { hanToUnigram, buildPhraseQuery, isCjk } from '../src/ingest/tokenizer';

describe('hanToUnigram', () => {
  it('한자를 글자 단위 공백 토큰으로 분리한다', () => {
    expect(hanToUnigram('卒本川')).toBe('卒 本 川');
  });

  it('표점·비CJK 문자를 구분자로 처리해 제외한다', () => {
    expect(hanToUnigram('新羅, 本紀 第一.')).toBe('新 羅 本 紀 第 一');
  });

  it('CJK 확장 B 영역(대체문자쌍) 희귀자를 안전하게 처리한다', () => {
    // U+20000 (𠀀) — surrogate pair
    const rare = String.fromCodePoint(0x20000);
    expect(hanToUnigram(`${rare}王`)).toBe(`${rare} 王`);
  });

  it('한자가 없으면 빈 문자열을 반환한다', () => {
    expect(hanToUnigram('abc 123 한글')).toBe('');
  });
});

describe('buildPhraseQuery', () => {
  it('다자 지명을 FTS5 phrase로 감싼다', () => {
    expect(buildPhraseQuery('卒本')).toBe('"卒 本"');
  });

  it('단자 지명도 phrase로 감싼다', () => {
    expect(buildPhraseQuery('河')).toBe('"河"');
  });

  it('한자가 없으면 빈 문자열(스킵 신호)을 반환한다', () => {
    expect(buildPhraseQuery('졸본')).toBe('');
  });
});

describe('isCjk', () => {
  it('기본 CJK 한자를 인식한다', () => {
    expect(isCjk('本'.codePointAt(0)!)).toBe(true);
  });

  it('한글·라틴은 CJK가 아니다', () => {
    expect(isCjk('가'.codePointAt(0)!)).toBe(false);
    expect(isCjk('A'.codePointAt(0)!)).toBe(false);
  });
});
