/**
 * @Project: kr-history-bm25
 * @File: variants.ts
 * @Description: 이표기(異表記) 동시검색. 사서가 명시한 동일 지명의 복수 한자 표기(예: 졸본=홀본)를 하나의 OR 질의로 확장한다.
 *               초기 매핑은 수동 시드(addVariantGroup)로 구축한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { Client } from '@libsql/client';
import type { VariantSearchResult } from '../types';
import { buildPhraseQuery } from '../ingest/tokenizer';
import { searchHanByMatch, type SearchHanOptions } from './search-han';

/** 이표기 그룹 멤버 지정 */
export interface VariantMemberSpec {
  /** 개체 유형(지명/이름 등) */
  type: string;
  /** 표기(한자) */
  surface: string;
}

/**
 * 이표기 그룹을 등록한다. 개체가 없으면 생성한다(코퍼스 미출현 표기도 매핑 가능).
 * @param client - libsql 클라이언트
 * @param members - 그룹 멤버(2개 이상)
 * @param note - 근거·비고
 * @param source - 출처(기본 manual)
 * @returns 생성된 그룹 id
 */
export async function addVariantGroup(
  client: Client,
  members: VariantMemberSpec[],
  note?: string,
  source = 'manual',
): Promise<number> {
  if (members.length < 2) {
    throw new Error('이표기 그룹은 2개 이상의 표기가 필요합니다.');
  }
  const group = await client.execute({
    sql: 'INSERT INTO variant_group (note, source) VALUES (?, ?)',
    args: [note ?? null, source],
  });
  const groupId = Number(group.lastInsertRowid);

  for (const member of members) {
    const entityId = await ensureEntity(client, member.type, member.surface);
    await client.execute({
      sql: 'INSERT OR IGNORE INTO variant_member (group_id, entity_id) VALUES (?, ?)',
      args: [groupId, entityId],
    });
  }
  return groupId;
}

/**
 * 표기의 이표기를 모두 확장해 병합 검색한다.
 * @param client - libsql 클라이언트
 * @param surface - 표기(한자)
 * @param options - 검색 옵션
 * @returns 확장 표기 목록 + 병합 검색 결과
 */
export async function withVariants(
  client: Client,
  surface: string,
  options: SearchHanOptions = {},
): Promise<VariantSearchResult> {
  const surfaces = await expandVariants(client, surface);
  const match = surfaces
    .map(buildPhraseQuery)
    .filter((m) => m !== '')
    .join(' OR ');
  const hits = match === '' ? [] : await searchHanByMatch(client, match, options);
  return { surfaces, hits };
}

/**
 * 표기가 속한 이표기 그룹의 모든 표기를 반환한다(자기 자신 포함, 그룹 없으면 자신만).
 * @param client - libsql 클라이언트
 * @param surface - 표기(한자)
 * @returns 표기 목록
 */
export async function expandVariants(client: Client, surface: string): Promise<string[]> {
  const result = await client.execute({
    sql: `
      SELECT DISTINCT e2.surface AS surface
        FROM entity e1
        JOIN variant_member vm1 ON vm1.entity_id = e1.id
        JOIN variant_member vm2 ON vm2.group_id = vm1.group_id
        JOIN entity e2 ON e2.id = vm2.entity_id
       WHERE e1.surface = ?
    `,
    args: [surface],
  });
  const surfaces = result.rows.map((row) => String(row.surface));
  return surfaces.length > 0 ? surfaces : [surface];
}

/** 개체를 확보한다(없으면 생성). unique(type,surface) 충돌은 무시하고 조회로 귀결 */
async function ensureEntity(client: Client, type: string, surface: string): Promise<number> {
  await client.execute({
    sql: 'INSERT OR IGNORE INTO entity (type, surface) VALUES (?, ?)',
    args: [type, surface],
  });
  const row = await client.execute({
    sql: 'SELECT id FROM entity WHERE type = ? AND surface = ?',
    args: [type, surface],
  });
  return Number(row.rows[0]?.id ?? 0);
}
