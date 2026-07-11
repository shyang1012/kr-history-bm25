/**
 * @Project: kr-history-bm25
 * @File: variant-classify.ts
 * @Description: 독음 검수 큐(원음 미확정 char)를 Unihan 변이 근거로 분류한다. 검수 대상 글자의
 *               변이대상이 확정 단일 본음을 가지면 그 본음을 이관해 해소하고, 다독음·미확정·충돌·
 *               변이없음·자기참조는 전부 residual(LLM 검수 대상)로 남겨 환각을 방지한다(F-02).
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import type { VariantTarget } from './variant-source';

/** 변이 근거로 이관 확정된 항목 */
export interface MigrateEntry {
  /** 이관 대상(검수 큐) char */
  char: string;
  /** 본음을 제공한 변이대상 char */
  via: string;
  /** 근거가 된 Unihan 필드명 */
  viaField: string;
  /** 이관된 독음 */
  reading: string;
}

/** 분류 결과 */
export interface ClassifyResult {
  /** 변이 근거로 해소된 항목 */
  resolvedByVariant: MigrateEntry[];
  /** 해소되지 않아 LLM 검수가 필요한 char 목록 */
  residual: string[];
}

/**
 * 검수 char 목록을 Unihan 변이 근거로 분류한다.
 * @param reviewChars - 검수 대상 char 목록(원음 미확정)
 * @param variantMap - loadVariantMap 결과
 * @param singleReadingOf - char의 확정 단일 본음(non-null) 또는 null(다독음·미확정)을 돌려준다
 * @returns resolvedByVariant(이관 해소)·residual(검수 유지)
 */
export function classifyByVariant(
  reviewChars: string[],
  variantMap: Map<string, VariantTarget[]>,
  singleReadingOf: (char: string) => string | null,
): ClassifyResult {
  const resolvedByVariant: MigrateEntry[] = [];
  const residual: string[] = [];

  for (const ch of reviewChars) {
    const candidates: VariantTarget[] = [];
    for (const { target, field } of variantMap.get(ch) ?? []) {
      if (target === ch) {
        continue;
      }
      if (singleReadingOf(target) !== null) {
        candidates.push({ target, field });
      }
    }

    const readings = new Set(
      candidates
        .map(({ target }) => singleReadingOf(target))
        .filter((r): r is string => r !== null),
    );

    const first = candidates[0];
    if (readings.size === 1 && first) {
      const reading = singleReadingOf(first.target);
      if (reading !== null) {
        resolvedByVariant.push({ char: ch, via: first.target, viaField: first.field, reading });
        continue;
      }
    }
    residual.push(ch);
  }

  return { resolvedByVariant, residual };
}
