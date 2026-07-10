/**
 * @Project: kr-history-bm25
 * @File: translate-corpus.ts
 * @Description: 보조 인덱스(직역) 증분 오케스트레이터. 미완 본문만 골라 LLM으로 직역하고, 채택 시 보조 FTS를 갱신한다.
 *               재개 가능(이미 done인 본문은 건너뜀). 국편위 번역은 사용하지 않는다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { DbConnection } from '../db/client';
import type { TranslationProvider, PassageContext } from './provider';
import { fetchPending, adopt, markFailed, countPending } from './translation-store';

/** 번역 실행 옵션 */
export interface TranslateOptions {
  /** 번역 provider */
  provider: TranslationProvider;
  /** 이번 실행에서 처리할 최대 본문 수 */
  limit?: number;
  /** 특정 코퍼스 코드로 제한 */
  corpusCode?: string;
  /** 진행 콜백 */
  onProgress?: (done: number, total: number, passageId: number) => void;
}

/** 번역 실행 통계 */
export interface TranslateStats {
  /** 이번 실행에서 시도한 본문 수 */
  attempted: number;
  /** 성공(채택) 수 */
  translated: number;
  /** 실패 수 */
  failed: number;
  /** 남은 미완 본문 수 */
  remaining: number;
}

/**
 * 코퍼스의 미완 본문을 증분 직역한다.
 * @param conn - DB 연결
 * @param options - 실행 옵션
 * @returns 실행 통계
 */
export async function translateCorpus(
  conn: DbConnection,
  options: TranslateOptions,
): Promise<TranslateStats> {
  const { client, provider } = { client: conn.client, provider: options.provider };
  const pending = await fetchPending(client, provider.name, options.limit, options.corpusCode);

  const stats: TranslateStats = {
    attempted: pending.length,
    translated: 0,
    failed: 0,
    remaining: 0,
  };

  let done = 0;
  for (const passage of pending) {
    const ctx: PassageContext = {
      passageId: passage.id,
      nodeId: passage.nodeId,
      corpusCode: passage.corpusCode,
      nodeTitle: passage.nodeTitle,
    };
    try {
      const result = await provider.translate(passage.textHan, ctx);
      await adopt(client, passage.id, provider.name, result.model, result.text);
      stats.translated += 1;
    } catch {
      await markFailed(client, passage.id, provider.name);
      stats.failed += 1;
    }
    done += 1;
    options.onProgress?.(done, pending.length, passage.id);
  }

  stats.remaining = await countPending(client, provider.name, options.corpusCode);
  return stats;
}
