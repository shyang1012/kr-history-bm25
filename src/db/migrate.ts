/**
 * @Project: kr-history-bm25
 * @File: migrate.ts
 * @Description: hand-written SQL 마이그레이션 러너. 적용 이력을 _migrations 테이블로 추적하여 멱등 실행을 보장한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { Client } from '@libsql/client';
import * as init from './migrations/0001-init';
import * as reading from './migrations/0002-reading';

/** 마이그레이션 1건 */
interface Migration {
  version: string;
  sql: string;
}

/** 적용 순서대로 나열한 마이그레이션 목록 */
const MIGRATIONS: Migration[] = [
  { version: init.VERSION, sql: init.SQL },
  { version: reading.VERSION, sql: reading.SQL },
];

/**
 * 미적용 마이그레이션을 순서대로 적용한다. 이미 적용된 버전은 건너뛴다(멱등).
 * @param client - libsql 클라이언트
 * @returns 이번 호출에서 적용한 버전 목록
 */
export async function runMigrations(client: Client): Promise<string[]> {
  await client.execute(`
    CREATE TABLE IF NOT EXISTS _migrations (
        version    TEXT PRIMARY KEY
      , applied_at TEXT NOT NULL
    )
  `);

  const applied = new Set<string>();
  const rows = await client.execute('SELECT version FROM _migrations');
  for (const row of rows.rows) {
    applied.add(String(row.version));
  }

  const justApplied: string[] = [];
  for (const migration of MIGRATIONS) {
    if (applied.has(migration.version)) {
      continue;
    }
    await client.executeMultiple(migration.sql);
    await client.execute({
      sql: 'INSERT INTO _migrations (version, applied_at) VALUES (?, ?)',
      args: [migration.version, new Date().toISOString()],
    });
    justApplied.push(migration.version);
  }
  return justApplied;
}
