/**
 * @Project: kr-history-bm25
 * @File: batch.ts
 * @Description: 구독 모델(gpt-5.4-mini via Ask-Codex, Claude sub-agent 등) 직역 배치 흐름. CLI는 HTTP provider를
 *               직접 호출하지 않고, 대기 본문을 내보내고(export) 메인 에이전트가 만든 직역 결과를 적재(import)만 한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { DbConnection } from '../db/client';
import { fetchPending, adopt, countPending } from './translation-store';

/** 배치 내보내기 옵션 */
export interface ExportPendingOptions {
  /** 결과를 채택할 provider 이름(예: codex) */
  provider: string;
  /** 특정 코퍼스 코드로 제한 */
  corpusCode?: string;
  /** 내보낼 최대 본문 수 */
  limit?: number;
}

/** 내보낼 본문 1건(직역 대상 최소 정보) */
export interface ExportPassage {
  /** 본문 id */
  id: number;
  /** 한자 원문 */
  han: string;
}

/** 배치 내보내기 결과 */
export interface ExportPendingResult {
  /** 결과를 채택할 provider 이름 */
  provider: string;
  /** 내보낸 본문 수 */
  count: number;
  /** 대기 본문 목록 */
  passages: ExportPassage[];
}

/**
 * provider의 done 직역이 없는 대기 본문을 내보낸다.
 * @param conn - DB 연결
 * @param options - 내보내기 옵션
 * @returns 대기 본문 목록(provider·count 포함)
 */
export async function exportPending(
  conn: DbConnection,
  options: ExportPendingOptions,
): Promise<ExportPendingResult> {
  const pending = await fetchPending(
    conn.client,
    options.provider,
    options.limit,
    options.corpusCode,
  );
  const passages: ExportPassage[] = pending.map((p) => ({ id: p.id, han: p.textHan }));
  return { provider: options.provider, count: passages.length, passages };
}

/** 배치 직역 결과 1건 */
export interface BatchTranslationResult {
  /** 본문 id */
  id: number;
  /** 직역 텍스트(한국어) */
  ko: string;
}

/** 배치 적재 옵션 */
export interface ImportResultsOptions {
  /** 결과를 채택할 provider 이름(예: codex) */
  provider: string;
  /** 사용 모델명 */
  model?: string;
  /** 직역 결과 목록 */
  results: BatchTranslationResult[];
}

/** 배치 적재 통계 */
export interface ImportResultsStats {
  /** 채택(적재)된 건수 */
  imported: number;
  /** 빈 직역이라 건너뛴 건수 */
  skipped: number;
  /** 적재 후 남은 미완 본문 수 */
  remaining: number;
}

/** 결과에 model이 없을 때 채택 저장에 사용할 기본 모델명 */
const DEFAULT_MODEL = 'unknown';

/**
 * 직역 결과를 적재한다(채택 저장 + 보조 FTS 갱신). 빈 직역은 건너뛴다.
 * @param conn - DB 연결
 * @param options - 적재 옵션
 * @returns 적재 통계
 */
export async function importResults(
  conn: DbConnection,
  options: ImportResultsOptions,
): Promise<ImportResultsStats> {
  const model = options.model ?? DEFAULT_MODEL;
  let imported = 0;
  let skipped = 0;

  for (const result of options.results) {
    const ko = result.ko.trim();
    if (ko === '') {
      skipped += 1;
      continue;
    }
    await adopt(conn.client, result.id, options.provider, model, ko);
    imported += 1;
  }

  const remaining = await countPending(conn.client, options.provider, undefined);
  return { imported, skipped, remaining };
}
