/**
 * @Project: kr-history-bm25
 * @File: client.ts
 * @Description: libsql 클라이언트 + Drizzle 인스턴스 생성. 로컬 파일/인메모리 SQLite 연결을 표준화한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { createClient, type Client } from '@libsql/client';
import { drizzle, type LibSQLDatabase } from 'drizzle-orm/libsql';
import * as schema from './schema';

/** DB 연결 핸들 — 저수준 libsql 클라이언트와 Drizzle 인스턴스를 함께 보유 */
export interface DbConnection {
  /** 저수준 libsql 클라이언트 · raw SQL(FTS5)·executeMultiple용 */
  client: Client;
  /** Drizzle ORM 인스턴스 · 관계형 CRUD용 */
  db: LibSQLDatabase<typeof schema>;
}

/**
 * 파일 경로를 libsql url로 변환한다. ':memory:'는 그대로, 그 외는 file: 스킴으로 정규화한다.
 * @param path - 로컬 파일 경로 또는 ':memory:'
 * @returns libsql url
 */
export function toLibsqlUrl(path: string): string {
  if (path === ':memory:') {
    return ':memory:';
  }
  if (path.startsWith('file:')) {
    return path;
  }
  return `file:${path.replace(/\\/g, '/')}`;
}

/**
 * libsql 클라이언트와 Drizzle 인스턴스를 생성한다.
 * @param path - SQLite 파일 경로 또는 ':memory:'
 * @returns DB 연결 핸들
 */
export function createDbConnection(path: string): DbConnection {
  const client = createClient({ url: toLibsqlUrl(path) });
  const db = drizzle(client, { schema });
  return { client, db };
}
