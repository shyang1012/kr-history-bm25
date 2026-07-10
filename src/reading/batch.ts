/**
 * @Project: kr-history-bm25
 * @File: batch.ts
 * @Description: 원음 char 단위 LLM 검수 배치. translate/batch의 export/import + resume/skip를 답습하되
 *               결과 스키마는 독립({char, reading, status, note}). 검수 단위가 char라서 邯 1회 판정이
 *               모든 姜邯·邯城… surface에 전파된다(중복·불일치 제거). verified는 char_reading에 source='llm'
 *               seq=-1(본음 최우선)로 확정하고, failed는 저장하지 않고 카운트만 한다(명시 실패, silent 0).
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import type { InStatement } from '@libsql/client';
import type { DbConnection } from '../db/client';
import type { Seeds } from './seed';

const HAN = /\p{Script=Han}/u;

/** 검수 대기 char 1건 */
export interface PendingChar {
  char: string;
  /** 사유 · 'polyphone'(진짜 다음자) | 'rare'(희귀자·char_reading 부재) */
  reason: 'polyphone' | 'rare';
  /** 다음자 후보 독음(polyphone일 때) */
  candidates?: string[];
}

/** export 결과 */
export interface ReadingExport {
  count: number;
  chars: PendingChar[];
}

/** 검수 결과 1건(import 입력) */
export interface ReadingResult {
  char: string;
  reading: string;
  status: 'verified' | 'failed';
  note?: string;
}

/** import 통계 */
export interface ImportStats {
  imported: number;
  failed: number;
  remaining: number;
}

interface CharRow {
  reading: string;
  isDueum: number;
  source: string;
}

async function loadCharGroups(conn: DbConnection): Promise<Map<string, CharRow[]>> {
  const rows = await conn.client.execute(
    'SELECT char, reading, seq, is_dueum, source FROM char_reading ORDER BY char, seq',
  );
  const map = new Map<string, CharRow[]>();
  for (const r of rows.rows) {
    const ch = String(r.char);
    const list = map.get(ch) ?? [];
    list.push({
      reading: String(r.reading),
      isDueum: Number(r.is_dueum),
      source: String(r.source),
    });
    map.set(ch, list);
  }
  return map;
}

/**
 * 원음 확정이 안 된 char(진짜 다음자·희귀자)를 검수 대상으로 내보낸다.
 * 이미 seed/llm으로 확정된 char는 제외한다(resume).
 * @param conn - DB 연결
 * @param opts.seeds - 학술시드(charSeeds에 있는 글자는 확정으로 간주해 제외)
 * @returns 검수 대기 char 목록
 */
export async function exportPendingReadingChars(
  conn: DbConnection,
  opts?: { seeds?: Seeds },
): Promise<ReadingExport> {
  const entities = await conn.client.execute('SELECT surface FROM entity');
  const used = new Set<string>();
  for (const row of entities.rows) {
    for (const ch of String(row.surface)) {
      if (HAN.test(ch)) {
        used.add(ch);
      }
    }
  }

  const groups = await loadCharGroups(conn);
  const charSeeds = opts?.seeds?.charSeeds ?? new Map<string, unknown>();

  const pending: PendingChar[] = [];
  for (const ch of [...used].sort()) {
    if (charSeeds.has(ch)) {
      continue;
    }
    const cands = groups.get(ch);
    if (cands?.some((c) => c.source === 'llm' || c.source === 'seed')) {
      continue;
    }
    if (!cands) {
      pending.push({ char: ch, reason: 'rare' });
      continue;
    }
    const bon = cands.filter((c) => c.isDueum === 0);
    if (bon.length > 1) {
      pending.push({ char: ch, reason: 'polyphone', candidates: bon.map((b) => b.reading) });
    }
  }
  return { count: pending.length, chars: pending };
}

/**
 * 검수 결과를 적재한다. verified는 char_reading에 source='llm' seq=-1(본음 최우선)로 확정하고,
 * failed·빈 결과는 저장하지 않고 카운트만 한다.
 * @param conn - DB 연결
 * @param results - 검수 결과 목록
 * @param opts.seeds - remaining 계산 시 제외할 시드
 * @returns import 통계
 */
export async function importReadingChars(
  conn: DbConnection,
  results: ReadingResult[],
  opts?: { seeds?: Seeds },
): Promise<ImportStats> {
  let imported = 0;
  let failed = 0;
  const stmts: InStatement[] = [];
  for (const r of results) {
    if (r.status === 'failed' || !r.reading?.trim()) {
      failed++;
      continue;
    }
    stmts.push({
      sql: `INSERT INTO char_reading (char, reading, source, seq, is_dueum) VALUES (?, ?, 'llm', -1, 0)
            ON CONFLICT (char, reading) DO UPDATE SET source = 'llm', seq = -1, is_dueum = 0`,
      args: [r.char, r.reading],
    });
    imported++;
  }
  if (stmts.length > 0) {
    await conn.client.batch(stmts, 'write');
  }
  const after = await exportPendingReadingChars(conn, opts);
  return { imported, failed, remaining: after.count };
}
