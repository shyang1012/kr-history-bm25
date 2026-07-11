/**
 * @Project: kr-history-bm25
 * @File: reading-variant.test.ts
 * @Description: 독음 검수 큐의 간자체/이체자 변이 분류(variant-source·variant-classify) 검증.
 *               Unihan_Variants.txt 파싱(주석 제거·다중 코드포인트·kSpoofingVariant 제외·자기참조 제외)과
 *               F-02 안전조건(다독음·미확정·충돌·변이없음·자기참조는 전부 residual) 커버.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { describe, it, expect } from 'vitest';
import { fileURLToPath } from 'node:url';
import { loadVariantMap, type VariantTarget } from '../src/reading/variant-source';
import { classifyByVariant } from '../src/reading/variant-classify';

const variantsSample = fileURLToPath(
  new URL('./fixtures/unihan-variants-sample.txt', import.meta.url),
);

describe('variant-source(loadVariantMap) — Unihan_Variants.txt 파싱', () => {
  const map = loadVariantMap(variantsSample);

  it('<주석을 제거하고 코드포인트를 한자로 변환한다', () => {
    const targets = map.get('两') ?? [];
    expect(targets.map((t) => t.target)).toContain('両');
  });

  it('다중 코드포인트 값을 각각의 대상으로 분해한다(U+4E24 kTraditionalVariant → U+4E24 U+5169)', () => {
    const targets = map.get('义') ?? [];
    expect(targets).toEqual<VariantTarget[]>([{ target: '義', field: 'kTraditionalVariant' }]);
  });

  it('kSpoofingVariant는 제외한다(U+340A)', () => {
    const spoofingChar = String.fromCodePoint(0x340a);
    expect(map.has(spoofingChar)).toBe(false);
  });

  it('자기참조(대상==자신)는 제외한다', () => {
    const targets = map.get('两') ?? [];
    expect(targets.some((t) => t.target === '两')).toBe(false);
  });

  it('한 필드 값에 담긴 복수 대상·주석을 모두 정확히 분해한다(U+5169 kSemanticVariant)', () => {
    const targets = map.get('兩') ?? [];
    expect(targets).toEqual<VariantTarget[]>([
      { target: '両', field: 'kSemanticVariant' },
      { target: '两', field: 'kSemanticVariant' },
    ]);
  });

  it('단일 대상(kTraditionalVariant, 주석 없음)도 정상 파싱한다', () => {
    const src = String.fromCodePoint(0x3437);
    const dst = String.fromCodePoint(0x508c);
    expect(map.get(src)).toEqual<VariantTarget[]>([{ target: dst, field: 'kTraditionalVariant' }]);
  });
});

describe('variant-classify(classifyByVariant) — F-02 안전조건', () => {
  it('1) 정상 이관: 변이대상이 단일본음이면 그 독음을 이관한다(viaField 보존)', () => {
    const variantMap = new Map<string, VariantTarget[]>([
      ['両', [{ target: '兩', field: 'kTraditionalVariant' }]],
    ]);
    const singleReadingOf = (c: string): string | null => (c === '兩' ? '량' : null);

    const result = classifyByVariant(['両'], variantMap, singleReadingOf);

    expect(result.resolvedByVariant).toEqual([
      { char: '両', via: '兩', viaField: 'kTraditionalVariant', reading: '량' },
    ]);
    expect(result.residual).toEqual([]);
  });

  it('2) 변이대상이 다독음(singleReadingOf=null)이면 residual', () => {
    const variantMap = new Map<string, VariantTarget[]>([
      ['甲', [{ target: '乙', field: 'kZVariant' }]],
    ]);
    const singleReadingOf = (): string | null => null;

    const result = classifyByVariant(['甲'], variantMap, singleReadingOf);

    expect(result.resolvedByVariant).toEqual([]);
    expect(result.residual).toEqual(['甲']);
  });

  it('3) 다대다 충돌: 두 변이대상의 독음이 서로 다르면 residual', () => {
    const variantMap = new Map<string, VariantTarget[]>([
      [
        '丙',
        [
          { target: '丁', field: 'kSemanticVariant' },
          { target: '戊', field: 'kZVariant' },
        ],
      ],
    ]);
    const singleReadingOf = (c: string): string | null =>
      c === '丁' ? '가' : c === '戊' ? '나' : null;

    const result = classifyByVariant(['丙'], variantMap, singleReadingOf);

    expect(result.resolvedByVariant).toEqual([]);
    expect(result.residual).toEqual(['丙']);
  });

  it('4) 두 변이대상의 독음이 같으면 이관(일치)', () => {
    const variantMap = new Map<string, VariantTarget[]>([
      [
        '己',
        [
          { target: '庚', field: 'kSemanticVariant' },
          { target: '辛', field: 'kZVariant' },
        ],
      ],
    ]);
    const singleReadingOf = (c: string): string | null => (c === '庚' || c === '辛' ? '량' : null);

    const result = classifyByVariant(['己'], variantMap, singleReadingOf);

    expect(result.resolvedByVariant).toEqual([
      { char: '己', via: '庚', viaField: 'kSemanticVariant', reading: '량' },
    ]);
    expect(result.residual).toEqual([]);
  });

  it('5) self-link(대상==자신만)면 residual', () => {
    const variantMap = new Map<string, VariantTarget[]>([
      ['壬', [{ target: '壬', field: 'kSimplifiedVariant' }]],
    ]);
    const singleReadingOf = (): string | null => '량';

    const result = classifyByVariant(['壬'], variantMap, singleReadingOf);

    expect(result.resolvedByVariant).toEqual([]);
    expect(result.residual).toEqual(['壬']);
  });

  it('6) 순환(C→T, T→C)이어도 재귀 없이 singleReadingOf(T) 값만으로 정상 처리한다', () => {
    const variantMap = new Map<string, VariantTarget[]>([
      ['癸', [{ target: '子', field: 'kZVariant' }]],
      ['子', [{ target: '癸', field: 'kZVariant' }]],
    ]);

    // T(子)가 자체 확정 단일본음을 가지는 경우 → 이관
    const resolved = classifyByVariant(['癸'], variantMap, (c) => (c === '子' ? '량' : null));
    expect(resolved.resolvedByVariant).toEqual([
      { char: '癸', via: '子', viaField: 'kZVariant', reading: '량' },
    ]);
    expect(resolved.residual).toEqual([]);

    // T(子)가 미확정이면 → C도 residual(순환을 따라가지 않는다)
    const unresolved = classifyByVariant(['癸'], variantMap, () => null);
    expect(unresolved.resolvedByVariant).toEqual([]);
    expect(unresolved.residual).toEqual(['癸']);
  });

  it('7) 변이 없음(map에 항목 없음)이면 residual', () => {
    const variantMap = new Map<string, VariantTarget[]>();
    const singleReadingOf = (): string | null => '량';

    const result = classifyByVariant(['丑'], variantMap, singleReadingOf);

    expect(result.resolvedByVariant).toEqual([]);
    expect(result.residual).toEqual(['丑']);
  });
});
