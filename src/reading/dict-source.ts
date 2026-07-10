/**
 * @Project: kr-history-bm25
 * @File: dict-source.ts
 * @Description: 표준국어대사전 JSON(국립국어원)에서 한자 표기 → 관용독음 인덱스를 구축한다.
 *               관용 도출(conventional)의 dict 소스. 표제어의 숫자접미사·붙임표는 정규화한다.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import { readFileSync } from 'node:fs';

/** 표준국어대사전 item 최소 구조 */
interface StdictItem {
  word_info?: {
    word?: string;
    original_language_info?: {
      original_language?: string;
      language_type?: string;
    }[];
  };
}
interface StdictFile {
  channel?: { item?: StdictItem[] };
}

/** 표제어 정규화: 숫자접미사(고려01)·붙임표(-·^)·가운뎃점·공백 제거 */
function normWord(word: string): string {
  return word.replace(/\d+$/, '').replace(/[-\s·^]/g, '');
}

/**
 * 표준국어대사전 JSON 파일들을 읽어 한자→관용독음 인덱스를 만든다.
 * 같은 한자가 여러 표제어에 걸리면 첫 등장을 채택한다.
 * @param paths - 표준국어대사전 JSON 파일 경로 목록
 * @returns 한자 표기 → 관용독음 Map
 */
export function buildDictIndex(paths: string[]): Map<string, string> {
  const idx = new Map<string, string>();
  for (const path of paths) {
    const parsed = JSON.parse(readFileSync(path, 'utf8')) as StdictFile;
    const items = parsed.channel?.item ?? [];
    for (const item of items) {
      const wi = item.word_info;
      if (!wi?.word) {
        continue;
      }
      const reading = normWord(wi.word);
      for (const o of wi.original_language_info ?? []) {
        if (o.language_type === '한자' && o.original_language && !idx.has(o.original_language)) {
          idx.set(o.original_language, reading);
        }
      }
    }
  }
  return idx;
}
