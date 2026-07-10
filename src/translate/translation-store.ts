/**
 * @Project: kr-history-bm25
 * @File: translation-store.ts
 * @Description: 직역(translation) 영속 로직 공용 store. 미완 조회·채택(FTS 갱신)·실패 기록·잔여 수 집계를
 *               한 곳에 모아 translate-corpus(온라인 provider)와 batch(오프라인 구독 모델 왕복)가 함께 쓴다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { Client } from '@libsql/client';
import { koToUnigram } from '../ingest/tokenizer';

/** 미완 본문 1건 */
export interface PendingPassage {
  /** 본문 id */
  id: number;
  /** 소속 노드 id */
  nodeId: string;
  /** 한자 원문 */
  textHan: string;
  /** 코퍼스 코드 */
  corpusCode: string;
  /** 노드 제목 */
  nodeTitle: string | null;
}

/**
 * 미완(=해당 provider의 done 직역이 없는) 본문을 조회한다.
 * @param client - libsql 클라이언트
 * @param provider - 대상 provider 이름
 * @param limit - 최대 조회 수(미지정 시 전체)
 * @param corpusCode - 코퍼스 코드 제한(미지정 시 전체)
 * @returns id 순 미완 본문 목록
 */
export async function fetchPending(
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

/**
 * 남은 미완 본문 수를 센다.
 * @param client - libsql 클라이언트
 * @param provider - 대상 provider 이름
 * @param corpusCode - 코퍼스 코드 제한(미지정 시 전체)
 * @returns 미완 본문 수
 */
export async function countPending(
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

/**
 * 직역을 채택 저장하고 보조 FTS를 갱신한다.
 * @param client - libsql 클라이언트
 * @param passageId - 본문 id
 * @param provider - provider 이름
 * @param model - 사용 모델명
 * @param text - 직역 텍스트
 */
export async function adopt(
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
        // 색인 컬럼은 음절 단위 토큰(조사 결합 극복). 표시는 translation.text(원문 그대로) 사용.
        sql: 'INSERT INTO passage_fts_ko (ko_text, passage_id) VALUES (?, ?)',
        args: [koToUnigram(text), passageId],
      },
    ],
    'write',
  );
}

/**
 * 실패를 기록한다(FTS 미변경, 다음 실행에서 재시도).
 * @param client - libsql 클라이언트
 * @param passageId - 본문 id
 * @param provider - provider 이름
 */
export async function markFailed(
  client: Client,
  passageId: number,
  provider: string,
): Promise<void> {
  await client.execute({
    sql: `INSERT INTO translation (passage_id, provider, status, adopted, created_at)
          VALUES (?, ?, 'failed', 0, ?)
          ON CONFLICT (passage_id, provider) DO UPDATE SET
              status     = 'failed'
            , created_at = excluded.created_at`,
    args: [passageId, provider, new Date().toISOString()],
  });
}
