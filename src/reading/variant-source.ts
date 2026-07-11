/**
 * @Project: kr-history-bm25
 * @File: variant-source.ts
 * @Description: Unihan_Variants.txt를 파싱해 char → 변이대상 목록 Map을 만든다. 정자법 등가 필드
 *               (kTraditionalVariant·kSimplifiedVariant·kSemanticVariant·kSpecializedSemanticVariant·
 *               kZVariant)만 대상으로 하고, 시각적 혼동용 kSpoofingVariant는 제외한다.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { readFileSync } from 'node:fs';

/** char_reading 이관 근거로 삼는 Unihan 변이 필드(정자법 등가). kSpoofingVariant는 제외 */
const VARIANT_FIELDS = new Set([
  'kTraditionalVariant',
  'kSimplifiedVariant',
  'kSemanticVariant',
  'kSpecializedSemanticVariant',
  'kZVariant',
]);

/** 변이 대상 1건 */
export interface VariantTarget {
  /** 변이 대상 한자(1자) */
  target: string;
  /** 근거가 된 Unihan 필드명 */
  field: string;
}

/**
 * Unihan_Variants.txt를 파싱해 char → 변이대상 목록 Map을 만든다.
 * @param variantsPath - Unihan_Variants.txt 경로
 * @returns char → VariantTarget[] (자기참조 제외)
 */
export function loadVariantMap(variantsPath: string): Map<string, VariantTarget[]> {
  const txt = readFileSync(variantsPath, 'utf8');

  const map = new Map<string, VariantTarget[]>();
  for (const line of txt.split(/\r?\n/)) {
    if (!line || line.startsWith('#')) {
      continue;
    }
    const parts = line.split('\t');
    const cp = parts[0];
    const field = parts[1];
    const val = parts[2];
    if (!cp || !field || !val || !VARIANT_FIELDS.has(field)) {
      continue;
    }
    const ch = String.fromCodePoint(parseInt(cp.replace('U+', ''), 16));
    const targets = val
      .trim()
      .split(/\s+/)
      .map((tok) => tok.split('<')[0])
      .filter((t): t is string => Boolean(t))
      .map((t) => String.fromCodePoint(parseInt(t.replace('U+', ''), 16)))
      .filter((t) => t !== ch);
    if (targets.length === 0) {
      continue;
    }
    const list = map.get(ch) ?? [];
    for (const target of targets) {
      list.push({ target, field });
    }
    map.set(ch, list);
  }
  return map;
}
