/**
 * @Project: kr-history-bm25
 * @File: search-by-reading.ts
 * @Description: reading-aware 검색 — 한글 독음 질의를 채택 독음 역매칭으로 한자 표기(surface)로 바꾸고,
 *               이표기(異表記)를 확장한 뒤 한자 BM25로 병합 검색한다. 반환에 대표음(사전 표제음)·관용 독음을
 *               병기해, 사용자가 한글로 물어도 원문 한자를 찾고 독음 이력을 함께 본다(krh-6x3).
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import type { Client } from '@libsql/client';
import type { SearchHit } from '../types';
import { buildPhraseQuery } from '../ingest/tokenizer';
import { lookupEntitiesByReading } from '../reading/reading-store';
import { expandVariants } from './variants';
import { searchHanByMatch, type SearchHanOptions } from './search-han';

/** 독음이 일치한 개체 1건(대표음·관용 병기) */
export interface ReadingMatch {
  /** 개체 id */
  entityId: number;
  /** 표기(한자) */
  surface: string;
  /** 개체 유형 */
  type: string;
  /** 대표음(사전 표제음, reading_type=original) */
  original: string | null;
  /** 관용 독음(reading_type=conventional) */
  conventional: string | null;
  /** 대표음 출처(synth|dict|llm|seed|rule) */
  originalSource: string | null;
}

/** reading-aware 검색 결과 */
export interface ReadingSearchResult {
  /** 질의(한글 독음) */
  query: string;
  /** 독음이 일치한 개체 목록 */
  matches: ReadingMatch[];
  /** 이표기 확장 포함, 한자 검색에 쓴 표기 목록 */
  surfaces: string[];
  /** 병합 BM25 결과 */
  hits: SearchHit[];
}

/** 표시 메타(readingType 파생, DB 컬럼 아님) */
export interface ReadingDisplay {
  /** 기계 판독용 역할 키 */
  displayRole: string;
  /** 사용자-facing 라벨(한국어) */
  label: string;
}

/**
 * reading_type을 사용자-facing 표시 메타로 파생한다. 'original'은 음운사 원형 주장이 아니라
 * 추적성 기준 대표키(사전 표제음)이므로 라벨을 "대표음"으로 풀어 오해를 막는다.
 * @param readingType - 'original'(대표음) | 'conventional'(관용)
 * @returns 표시 역할·라벨
 */
export function readingDisplay(readingType: 'original' | 'conventional'): ReadingDisplay {
  return readingType === 'original'
    ? { displayRole: 'dictionary_headword', label: '대표음(사전 표제음)' }
    : { displayRole: 'conventional_reading', label: '관용 독음' };
}

/**
 * 한글 독음으로 한자 원문을 검색한다. 채택 독음(대표음·관용) 역매칭 → 표기 이표기 확장 → 한자 BM25 병합.
 * @param client - libsql 클라이언트
 * @param query - 한글 독음(예: '강감찬')
 * @param options - 검색 옵션(limit=매칭 개체 상한 겸 결과 상한, corpusCode)
 * @returns 매칭 개체·확장 표기·병합 검색 결과
 */
export async function searchByReading(
  client: Client,
  query: string,
  options: SearchHanOptions = {},
): Promise<ReadingSearchResult> {
  const matches = await lookupEntitiesByReading(client, query, options.limit);
  if (matches.length === 0) {
    return { query, matches: [], surfaces: [], hits: [] };
  }

  // 매칭 표기 → 이표기 확장 → 중복 제거(입력 순서 보존)
  const seen = new Set<string>();
  const surfaces: string[] = [];
  for (const m of matches) {
    for (const s of await expandVariants(client, m.surface)) {
      if (!seen.has(s)) {
        seen.add(s);
        surfaces.push(s);
      }
    }
  }

  const match = surfaces
    .map(buildPhraseQuery)
    .filter((m) => m !== '')
    .join(' OR ');
  const hits = match === '' ? [] : await searchHanByMatch(client, match, options);

  return { query, matches, surfaces, hits };
}
