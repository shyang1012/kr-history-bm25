/**
 * @Project: kr-history-bm25
 * @File: reading-store.ts
 * @Description: 독음 사전 저장소 — char_reading 로드 + entity_reading 후보 저장/채택.
 *               translation-store.adopt 패턴 답습(raw @libsql/client, client.batch, ON CONFLICT DO UPDATE).
 *               채택은 "같은 개체·타입 기존 adopted=0 해제 후 대상 adopted=1"로 partial unique 불변식을 지킨다.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import type { Client } from '@libsql/client';
import type { CharCandidate } from './synthesize';

/** entity_reading 후보 입력 */
export interface ReadingInput {
  entityId: number;
  reading: string;
  readingType: 'original' | 'conventional';
  source: 'synth' | 'rule' | 'dict' | 'llm' | 'seed';
  status: string;
  confidence: number;
}

/**
 * char_reading을 char → 후보 목록 Map으로 로드한다(원음 합성 재료).
 * @param client - libsql 클라이언트
 * @returns char → CharCandidate[] (seq 오름차순)
 */
export async function loadCharMap(client: Client): Promise<Map<string, CharCandidate[]>> {
  const result = await client.execute(
    `SELECT char
          , reading
          , seq, is_dueum
          , source 
       FROM char_reading 
      ORDER BY char, seq`,
  );
  const map = new Map<string, CharCandidate[]>();
  for (const row of result.rows) {
    const ch = String(row.char);
    const list = map.get(ch) ?? [];
    list.push({
      reading: String(row.reading),
      seq: Number(row.seq),
      isDueum: Number(row.is_dueum),
      source: String(row.source),
    });
    map.set(ch, list);
  }
  return map;
}

/**
 * 미확정 후보를 adopted=0으로 저장한다(초안·검수 대기).
 * @param client - libsql 클라이언트
 * @param input - 후보 정보
 */
export async function saveDraft(client: Client, input: ReadingInput): Promise<void> {
  await client.execute({
    sql: `INSERT INTO entity_reading (
                                        entity_id
                                      , reading
                                      , reading_type
                                      , source
                                      , confidence
                                      , status
                                      , adopted
                                      , created_at
                                     )
                              VALUES (
                                        ?
                                      , ?
                                      , ?
                                      , ?
                                      , ?
                                      , ?
                                      , 0
                                      , ?
                                     )
                         ON CONFLICT (
                                        entity_id
                                      , reading_type
                                      , source
                                     )
          DO UPDATE SET reading = excluded.reading
                      , confidence = excluded.confidence
                      , status = excluded.status`,
    args: [
      input.entityId,
      input.reading,
      input.readingType,
      input.source,
      input.confidence,
      input.status,
      new Date().toISOString(),
    ],
  });
}

/**
 * 후보를 채택한다. 같은 개체·타입의 기존 채택을 해제한 뒤 대상을 adopted=1로 upsert(멱등).
 * @param client - libsql 클라이언트
 * @param input - 후보 정보
 */
export async function adoptReading(client: Client, input: ReadingInput): Promise<void> {
  await client.batch(
    [
      {
        sql: `UPDATE entity_reading SET adopted = 0 
                                  WHERE entity_id = ? 
                                    AND reading_type = ?`,
        args: [input.entityId, input.readingType],
      },
      {
        sql: `INSERT INTO entity_reading (entity_id, reading, reading_type, source, confidence, status, adopted, created_at)
              VALUES (?, ?, ?, ?, ?, ?, 1, ?)
              ON CONFLICT (entity_id, reading_type, source)
              DO UPDATE SET reading = excluded.reading, confidence = excluded.confidence, status = excluded.status, adopted = 1`,
        args: [
          input.entityId,
          input.reading,
          input.readingType,
          input.source,
          input.confidence,
          input.status,
          new Date().toISOString(),
        ],
      },
    ],
    'write',
  );
}
