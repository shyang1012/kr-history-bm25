/**
 * @Project: kr-history-bm25
 * @File: build-readings.ts
 * @Description: 독음 사전 파이프라인 오케스트레이션. 2-pass — Pass1: 원음(original) 확정
 *               (surface 시드 > char 시드 합성 > 자동확정, 미확정은 draft+검수큐),
 *               Pass2: 확정된 원음 기반 관용(conventional) 도출·채택. LLM 검수는 별도 배치(batch.ts).
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import type { DbConnection } from '../db/client';
import { synthesizeOriginal, type CharCandidate } from './synthesize';
import { deriveConventional } from './conventional';
import { adoptReading, saveDraft } from './reading-store';
import type { Seeds } from './seed';

/** 사전 구축 통계 */
export interface BuildStats {
  /** 처리한 개체 수 */
  entities: number;
  /** 원음 확정(채택) 개체 수 */
  originalConfirmed: number;
  /** 원음 미확정(draft, 검수 대기) 개체 수 */
  originalDraft: number;
  /** 관용 채택 개체 수 */
  conventionalAdopted: number;
  /** 원음≠관용(has_variant) 개체 수 */
  variants: number;
  /** LLM 검수 필요 글자(진짜 다음자·희귀자) */
  reviewChars: string[];
}

/**
 * 독음 사전을 구축한다(원음 확정 → 관용 도출).
 * @param conn - DB 연결
 * @param opts.charMap - char → 후보 독음(loadCharMap 결과)
 * @param opts.dict - 표준국어대사전 한자→관용독음 인덱스
 * @param opts.seeds - 학술시드
 * @returns 구축 통계
 */
export async function buildReadings(
  conn: DbConnection,
  opts: { charMap: Map<string, CharCandidate[]>; dict: Map<string, string>; seeds: Seeds },
): Promise<BuildStats> {
  const { charMap, dict, seeds } = opts;

  // 확정 소스를 charMap에 반영(글자 본음 단일화 → 합성 시 확정 처리). 우선순위: seed > llm > kHangul
  const merged = new Map(charMap);
  for (const [ch, cands] of charMap) {
    const llm = cands.find((c) => c.source === 'llm');
    if (llm) {
      merged.set(ch, [{ reading: llm.reading, seq: -1, isDueum: 0, source: 'llm' }]);
    }
  }
  for (const [ch, entry] of seeds.charSeeds) {
    merged.set(ch, [{ reading: entry.original, seq: 0, isDueum: 0, source: 'seed' }]);
  }

  const entities = await conn.client.execute('SELECT id, surface FROM entity');
  const reviewSet = new Set<string>();
  let originalConfirmed = 0;
  let originalDraft = 0;
  let conventionalAdopted = 0;
  let variants = 0;

  for (const row of entities.rows) {
    const id = Number(row.id);
    const surface = String(row.surface);

    // --- Pass 1: 원음 ---
    let originalReading: string | null = null;
    const surfaceSeed = seeds.surfaceSeeds.get(surface);
    if (surfaceSeed) {
      await adoptReading(conn.client, {
        entityId: id,
        reading: surfaceSeed.original,
        readingType: 'original',
        source: 'seed',
        status: 'seeded',
        confidence: 100,
      });
      originalReading = surfaceSeed.original;
    } else {
      const syn = synthesizeOriginal(surface, merged);
      if (syn.confirmed) {
        await adoptReading(conn.client, {
          entityId: id,
          reading: syn.reading,
          readingType: 'original',
          source: 'synth',
          status: 'auto_confirmed',
          confidence: 10,
        });
        originalReading = syn.reading;
      } else {
        await saveDraft(conn.client, {
          entityId: id,
          reading: syn.reading,
          readingType: 'original',
          source: 'synth',
          status: 'draft',
          confidence: 1,
        });
        syn.reviewChars.forEach((c) => reviewSet.add(c));
        originalDraft++;
      }
    }

    if (originalReading === null) {
      continue;
    }
    originalConfirmed++;

    // --- Pass 2: 관용(확정된 원음 기반) ---
    const conv = deriveConventional(surface, originalReading, dict);
    await adoptReading(conn.client, {
      entityId: id,
      reading: conv.reading,
      readingType: 'conventional',
      source: conv.source,
      status: 'auto_confirmed',
      confidence: conv.source === 'dict' ? 50 : 5,
    });
    conventionalAdopted++;
    if (conv.reading !== originalReading) {
      variants++;
    }
  }

  return {
    entities: entities.rows.length,
    originalConfirmed,
    originalDraft,
    conventionalAdopted,
    variants,
    reviewChars: [...reviewSet],
  };
}
