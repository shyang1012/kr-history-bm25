/**
 * @Project: kr-history-bm25
 * @File: ingest-unihan.ts
 * @Description: Unihan_Readings.txt(kHangul)를 파싱해 char_reading에 적재한다. 복수 독음은 seq로
 *               다음자(多音字)를 식별하고, 다른 독음의 두음법칙 결과와 일치하는 독음은 is_dueum=1로 태깅한다.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import { readFileSync } from 'node:fs';
import type { InStatement } from '@libsql/client';
import type { DbConnection } from '../db/client';
import { toDueum } from './dueum';

/** char_reading source 값 */
const SOURCE = 'unihan_khangul';

/** ingest 결과 통계 */
export interface IngestUnihanResult {
  /** 적재한 distinct 한자 수 */
  chars: number;
  /** 적재한 독음 행 수 */
  readings: number;
}

/**
 * Unihan_Readings.txt를 파싱해 char_reading을 적재한다.
 * @param conn - DB 연결
 * @param opts.readingsPath - Unihan_Readings.txt 경로
 * @returns 적재 통계
 */
export async function ingestUnihan(
  conn: DbConnection,
  opts: { readingsPath: string },
): Promise<IngestUnihanResult> {
  const txt = readFileSync(opts.readingsPath, 'utf8');

  // char → 독음 목록(Unihan 표기 순서 보존)
  const charReadings = new Map<string, string[]>();
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const parts = line.split('\t');
    const cp = parts[0];
    const field = parts[1];
    const val = parts[2];
    if (!cp || !val || field !== 'kHangul') {
      continue;
    }
    const ch = String.fromCodePoint(parseInt(cp.replace('U+', ''), 16));
    const readings = val
      .trim()
      .split(/\s+/)
      .map((tok) => tok.split(':')[0])
      .filter((r): r is string => Boolean(r));
    if (readings.length > 0) {
      charReadings.set(ch, readings);
    }
  }

  const stmts: InStatement[] = [];
  let readingCount = 0;
  for (const [ch, readings] of charReadings) {
    const readingSet = new Set(readings);
    readings.forEach((r, seq) => {
      // 두음형 판정: 다른 독음 r'가 있어 toDueum(r') === r (예: 麗의 '여'는 '려'의 두음형)
      let isDueum = 0;
      for (const other of readingSet) {
        if (other !== r && toDueum(other) === r) {
          isDueum = 1;
          break;
        }
      }
      stmts.push({
        // OR IGNORE — 재실행 멱등(기존 행·llm 검수 확정 seq=-1을 덮지 않음)
        sql: 'INSERT OR IGNORE INTO char_reading (char, reading, source, seq, is_dueum) VALUES (?, ?, ?, ?, ?)',
        args: [ch, r, SOURCE, seq, isDueum],
      });
      readingCount++;
    });
  }
  if (stmts.length > 0) {
    await conn.client.batch(stmts, 'write');
  }
  return { chars: charReadings.size, readings: readingCount };
}
