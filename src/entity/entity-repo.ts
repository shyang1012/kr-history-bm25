/**
 * @Project: kr-history-bm25
 * @File: entity-repo.ts
 * @Description: 색인 개체(지명·인물 등) 캐시·해석. 전역 unique(type,surface)를 메모리에 적재하고, 신규 개체에 ID를 선할당한다.
 *               대량 ingest에서 개체별 왕복 조회를 없애기 위한 관문. (CW-AP-D03 §11-0 perf 케이스)
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { Client } from '@libsql/client';

/** 신규 개체 삽입 레코드 */
export interface PendingEntity {
  id: number;
  type: string;
  surface: string;
}

/**
 * 개체 캐시 — (type, surface) → id 매핑을 보유하고 신규 개체에 ID를 선할당한다.
 * 전역 공유(사서 교차)로 동일 지명은 하나의 개체로 수렴한다.
 */
export class EntityCache {
  private readonly map = new Map<string, number>();

  private nextId = 1;

  private pending: PendingEntity[] = [];

  /** (type, surface) 조합 키 */
  private static key(type: string, surface: string): string {
    return `${type}\t${surface}`;
  }

  /**
   * 기존 개체를 DB에서 적재해 캐시를 채운다.
   * @param client - libsql 클라이언트
   */
  async load(client: Client): Promise<void> {
    const rows = await client.execute('SELECT id, type, surface FROM entity');
    let maxId = 0;
    for (const row of rows.rows) {
      const id = Number(row.id);
      this.map.set(EntityCache.key(String(row.type), String(row.surface)), id);
      if (id > maxId) {
        maxId = id;
      }
    }
    this.nextId = maxId + 1;
  }

  /**
   * 개체 ID를 해석한다. 없으면 신규 ID를 할당하고 pending에 적재한다.
   * @param type - 개체 유형(지명/이름 등)
   * @param surface - 표기(한자)
   * @returns 개체 ID
   */
  resolve(type: string, surface: string): number {
    const key = EntityCache.key(type, surface);
    const existing = this.map.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const id = this.nextId;
    this.nextId += 1;
    this.map.set(key, id);
    this.pending.push({ id, type, surface });
    return id;
  }

  /**
   * 미기록(pending) 신규 개체를 비우고 반환한다.
   * @returns 이번에 새로 생성된 개체 목록
   */
  drainPending(): PendingEntity[] {
    const drained = this.pending;
    this.pending = [];
    return drained;
  }
}
