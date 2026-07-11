/**
 * @Project: kr-history-bm25
 * @File: reading-store.ts
 * @Description: 독음 사전 저장소 — char_reading 로드 + entity_reading 후보 저장/채택.
 *               translation-store.adopt 패턴 답습(raw @libsql/client, client.batch, ON CONFLICT DO UPDATE).
 *               채택은 "같은 개체·타입 기존 adopted=0 해제 후 대상 adopted=1"로 partial unique 불변식을 지킨다.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import type { Client } from '@libsql/client';
import type { CharCandidate } from './synthesize';

/** 독음 역매칭으로 찾은 개체 1건(대표음·관용 병기) */
export interface ReadingEntity {
  /** 개체 id */
  entityId: number;
  /** 표기(한자) */
  surface: string;
  /** 개체 유형 */
  type: string;
  /** 채택된 대표음(사전 표제음, reading_type=original) */
  original: string | null;
  /** 채택된 관용 독음(reading_type=conventional) */
  conventional: string | null;
  /** 대표음의 출처(synth|dict|llm|seed|rule) */
  originalSource: string | null;
}

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

/**
 * 독음(한글, full surface reading)으로 채택된 개체를 역매칭한다.
 * 대상 개체의 채택 대표음(original)·관용 독음(conventional) 중 하나라도 reading과 일치하면 포함하며,
 * 매칭된 개체마다 두 레이어를 함께 반환한다(원문 검색 전 표기 확장의 재료).
 * @param client - libsql 클라이언트
 * @param reading - 독음(한글)
 * @param limit - 최대 개체 수(기본 50)
 * @returns 매칭 개체 목록(대표음·관용 병기)
 */
export async function lookupEntitiesByReading(
  client: Client,
  reading: string,
  limit = 50,
): Promise<ReadingEntity[]> {
  const result = await client.execute({
    sql: `SELECT e.id        AS entity_id
               , e.surface   AS surface
               , e.type      AS type
               , ro.reading  AS original
               , ro.source   AS original_source
               , rc.reading  AS conventional
            FROM entity e
            JOIN entity_reading rm ON rm.entity_id = e.id
                                   AND rm.adopted = 1
                                   AND rm.reading = ?
       LEFT JOIN entity_reading ro ON ro.entity_id = e.id
                                   AND ro.adopted = 1
                                   AND ro.reading_type = 'original'
       LEFT JOIN entity_reading rc ON rc.entity_id = e.id
                                   AND rc.adopted = 1
                                   AND rc.reading_type = 'conventional'
        GROUP BY e.id
               , e.surface
               , e.type
               , ro.reading
               , ro.source
               , rc.reading
           LIMIT ?`,
    args: [reading, limit],
  });
  return result.rows.map((row) => ({
    entityId: Number(row.entity_id),
    surface: String(row.surface),
    type: String(row.type),
    original: row.original === null ? null : String(row.original),
    conventional: row.conventional === null ? null : String(row.conventional),
    originalSource: row.original_source === null ? null : String(row.original_source),
  }));
}
