/**
 * @Project: kr-history-bm25
 * @File: simplified.ts
 * @Description: 간자체(簡體) 매핑 — Unihan kSimplifiedVariant를 char_simplified에 적재하고, 정자 표기(surface)를
 *               간자체로 변환한다. 지명 등을 간자체로 병기하면 연구자가 구글맵·바이두맵에 붙여 현존·위치를 확인한다.
 *               보조평면(확장영역) 간자체는 지도 검색에 비실용적이라 병기에서 제외한다(BMP만)—데이터는 전부 보존.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import type { InStatement, Client } from '@libsql/client';
import type { DbConnection } from '../db/client';
import { loadVariantMap } from './variant-source';

/** char_simplified source 값 */
const SOURCE = 'unihan_ksimplified';

/** 병기 실용 하한 — 보조평면(U+10000~) 간자체는 입력·지도 검색이 어려워 병기에서 제외 */
const SUPPLEMENTARY = 0x10000;

/** ingest 결과 통계 */
export interface IngestSimplifiedResult {
  /** 적재한 정자→간자체 매핑 수 */
  mappings: number;
}

/**
 * Unihan_Variants.txt의 kSimplifiedVariant를 char_simplified에 적재한다(정자→간자체 1:1, 첫 대상).
 * @param conn - DB 연결
 * @param opts.variantsPath - Unihan_Variants.txt 경로
 * @returns 적재 통계
 */
export async function ingestSimplified(
  conn: DbConnection,
  opts: { variantsPath: string },
): Promise<IngestSimplifiedResult> {
  const variantMap = loadVariantMap(opts.variantsPath);
  const stmts: InStatement[] = [];
  for (const [char, targets] of variantMap) {
    const simp = targets.find((t) => t.field === 'kSimplifiedVariant' && t.target !== char);
    if (!simp) {
      continue;
    }
    stmts.push({
      sql: `INSERT INTO char_simplified (char, simplified, source) VALUES (?, ?, ?)
            ON CONFLICT (char) DO UPDATE SET simplified = excluded.simplified, source = excluded.source`,
      args: [char, simp.target, SOURCE],
    });
  }
  if (stmts.length > 0) {
    await conn.client.batch(stmts, 'write');
  }
  return { mappings: stmts.length };
}

/**
 * char_simplified를 char → 간자체 Map으로 로드한다(병기 재료).
 * @param client - libsql 클라이언트
 * @returns 정자 char → 간자체 char
 */
export async function loadSimplifiedMap(client: Client): Promise<Map<string, string>> {
  const result = await client.execute('SELECT char, simplified FROM char_simplified');
  const map = new Map<string, string>();
  for (const row of result.rows) {
    map.set(String(row.char), String(row.simplified));
  }
  return map;
}

/** 간자체 변환 결과 */
export interface SimplifiedResult {
  /** 간자체 표기(변환 불가·불필요 글자는 정자 유지) */
  simplified: string;
  /** 정자와 다른가(간자체 병기 가치가 있는가) */
  changed: boolean;
}

/**
 * 정자 표기를 간자체로 변환한다. 보조평면(확장영역) 간자체는 지도 검색 비실용이라 정자를 유지한다(BMP만 반영).
 * @param surface - 정자(번체) 표기
 * @param map - loadSimplifiedMap 결과
 * @returns 간자체 표기 + 변경 여부
 */
export function toSimplified(surface: string, map: Map<string, string>): SimplifiedResult {
  let changed = false;
  const out = [...surface]
    .map((ch) => {
      const s = map.get(ch);
      if (s && s !== ch && (s.codePointAt(0) ?? 0) < SUPPLEMENTARY) {
        changed = true;
        return s;
      }
      return ch;
    })
    .join('');
  return { simplified: out, changed };
}
