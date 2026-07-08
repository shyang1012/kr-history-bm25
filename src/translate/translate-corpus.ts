/**
 * @Project: kr-history-bm25
 * @File: translate-corpus.ts
 * @Description: 보조 인덱스(직역) 증분 오케스트레이터. 미완 본문만 골라 LLM으로 직역하고, 채택 시 보조 FTS를 갱신한다.
 *               재개 가능(이미 done인 본문은 건너뜀). 국편위 번역은 사용하지 않는다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { Client } from '@libsql/client';
import type { DbConnection } from '../db/client';
import type { TranslationProvider, PassageContext } from './provider';

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

/** 미완 본문 1건 */
interface PendingPassage {
  id: number;
  nodeId: string;
  textHan: string;
  corpusCode: string;
  nodeTitle: string | null;
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

/** 미완(=해당 provider의 done 직역이 없는) 본문을 조회한다 */
async function fetchPending(
  client: Client,
  provider: string,
  limit: number | undefined,
  corpusCode: string | undefined,
): Promise<PendingPassage[]> {
  const args: (string | number)[] = [provider];
  let corpusFilter = '';
  if (corpusCode) {
    corpusFilter = '\n       AND c.code = ?';
    args.push(corpusCode);
  }
  let limitClause = '';
  if (limit !== undefined) {
    limitClause = '\n       LIMIT ?';
    args.push(limit);
  }

  const result = await client.execute({
    sql: `
      SELECT p.id       AS id
           , p.node_id  AS node_id
           , p.text_han AS text_han
           , c.code     AS corpus_code
           , n.title    AS node_title
        FROM passage p
        JOIN corpus c ON c.id = p.corpus_id
        JOIN node n ON n.id = p.node_id
       WHERE NOT EXISTS (
             SELECT 1
               FROM translation t
              WHERE t.passage_id = p.id
                AND t.provider = ?
                AND t.status = 'done'
       )${corpusFilter}
       ORDER BY p.id${limitClause}
    `,
    args,
  });

  return result.rows.map((row) => ({
    id: Number(row.id),
    nodeId: String(row.node_id),
    textHan: String(row.text_han),
    corpusCode: String(row.corpus_code),
    nodeTitle: row.node_title === null ? null : String(row.node_title),
  }));
}

/** 남은 미완 본문 수를 센다 */
async function countPending(
  client: Client,
  provider: string,
  corpusCode: string | undefined,
): Promise<number> {
  const args: string[] = [provider];
  let corpusFilter = '';
  if (corpusCode) {
    corpusFilter = '\n         AND c.code = ?';
    args.push(corpusCode);
  }
  const result = await client.execute({
    sql: `
      SELECT COUNT(*) AS c
        FROM passage p
        JOIN corpus c ON c.id = p.corpus_id
       WHERE NOT EXISTS (
             SELECT 1
               FROM translation t
              WHERE t.passage_id = p.id
                AND t.provider = ?
                AND t.status = 'done'
       )${corpusFilter}
    `,
    args,
  });
  return Number(result.rows[0]?.c ?? 0);
}

/** 직역을 채택 저장하고 보조 FTS를 갱신한다 */
async function adopt(
  client: Client,
  passageId: number,
  provider: string,
  model: string,
  text: string,
): Promise<void> {
  await client.batch(
    [
      // 같은 본문의 다른 provider 채택 해제(단일 채택 유지)
      { sql: 'UPDATE translation SET adopted = 0 WHERE passage_id = ?', args: [passageId] },
      {
        sql: `INSERT INTO translation (passage_id, provider, model, text, status, adopted, created_at)
              VALUES (?, ?, ?, ?, 'done', 1, ?)
              ON CONFLICT (passage_id, provider) DO UPDATE SET
                  model      = excluded.model
                , text       = excluded.text
                , status     = 'done'
                , adopted    = 1
                , created_at = excluded.created_at`,
        args: [passageId, provider, model, text, new Date().toISOString()],
      },
      { sql: 'DELETE FROM passage_fts_ko WHERE passage_id = ?', args: [passageId] },
      {
        sql: 'INSERT INTO passage_fts_ko (ko_text, passage_id) VALUES (?, ?)',
        args: [text, passageId],
      },
    ],
    'write',
  );
}

/** 실패를 기록한다(FTS 미변경, 다음 실행에서 재시도) */
async function markFailed(client: Client, passageId: number, provider: string): Promise<void> {
  await client.execute({
    sql: `INSERT INTO translation (passage_id, provider, status, adopted, created_at)
          VALUES (?, ?, 'failed', 0, ?)
          ON CONFLICT (passage_id, provider) DO UPDATE SET
              status     = 'failed'
            , created_at = excluded.created_at`,
    args: [passageId, provider, new Date().toISOString()],
  });
}
