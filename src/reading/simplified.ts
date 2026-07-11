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
  const result = await client.execute(`SELECT char
                                            , simplified 
                                         FROM char_simplified`);
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

/**
 * 질의 글자들에 한정해 역방향 맵(간자체 → 정자 후보[])을 로드한다. char_simplified를 역인덱스로 뒤집는다.
 * 하나의 간자체가 복수 정자에서 왔을 수 있어(다대일) 후보는 배열이다.
 * @param client - libsql 클라이언트
 * @param chars - 질의에 등장한 글자들
 * @returns 간자체 char → 정자 char[]
 */
export async function loadTraditionalForChars(
  client: Client,
  chars: string[],
): Promise<Map<string, string[]>> {
  const distinct = [...new Set(chars)];
  const map = new Map<string, string[]>();
  if (distinct.length === 0) {
    return map;
  }
  const placeholders = distinct.map(() => '?').join(', ');
  const result = await client.execute({
    sql: `SELECT char
               , simplified 
            FROM char_simplified 
           WHERE simplified IN (${placeholders})`,
    args: distinct,
  });
  for (const row of result.rows) {
    const trad = String(row.char);
    const simp = String(row.simplified);
    const list = map.get(simp) ?? [];
    list.push(trad);
    map.set(simp, list);
  }
  return map;
}

/** 간자체 질의 확장 결과 */
export interface QueryExpansion {
  /** 검색에 쓸 정자 후보 표기(원 질의 포함) */
  candidates: string[];
  /** 간자체가 감지돼 정자로 확장됐는가 */
  changed: boolean;
}

/** 후보 조합 폭주 방지 상한(모호 글자 다수 시) */
const MAX_CANDIDATES = 16;

/**
 * 간자체 질의를 정자 후보로 확장한다(다대일 모호는 OR 확장으로 전부 포함, 안전). 원 질의는 항상 포함한다.
 * @param query - 검색 질의(간자체 가능)
 * @param revMap - loadTraditionalForChars 결과(간자체→정자[])
 * @returns 정자 후보 목록 + 변경 여부
 */
export function expandSimplifiedToTraditional(
  query: string,
  revMap: Map<string, string[]>,
): QueryExpansion {
  let changed = false;
  let combos: string[] = [''];
  for (const ch of query) {
    const trads = revMap.get(ch);
    const options = trads && trads.length > 0 ? trads : [ch];
    if (trads && trads.length > 0) {
      changed = true;
    }
    const next: string[] = [];
    for (const prefix of combos) {
      for (const opt of options) {
        next.push(prefix + opt);
        if (next.length >= MAX_CANDIDATES) {
          break;
        }
      }
      if (next.length >= MAX_CANDIDATES) {
        break;
      }
    }
    combos = next;
  }
  const set = new Set(combos);
  set.add(query); // 원 질의(정자 그대로거나 코퍼스에 실재 가능) 항상 포함
  return { candidates: [...set], changed };
}
