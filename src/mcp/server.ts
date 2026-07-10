#!/usr/bin/env node
/**
 * @Project: kr-history-bm25
 * @File: server.ts
 * @Description: krh-mcp 엔트리. 동봉 코퍼스(또는 KRH_DB)를 열어 MCP 서버를 stdio로 노출한다.
 *               🔴 stdout은 MCP 프로토콜 전용 — 로그·오류는 stderr로만 출력한다.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { openBundledDb } from '../bundled-db';
import { openHistoryDb } from '../history-db';
import { createMcpServer } from './create-server';

async function main(): Promise<void> {
  // KRH_DB 지정 시 해당 코퍼스, 아니면 동봉본 자동 오픈
  const dbPath = process.env.KRH_DB;
  const db = dbPath ? await openHistoryDb(dbPath) : await openBundledDb();

  const server = createMcpServer(db);
  const transport = new StdioServerTransport();

  const shutdown = (): void => {
    try {
      db.close();
    } finally {
      process.exit(0);
    }
  };
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);

  await server.connect(transport);
}

main().catch((err: unknown) => {
  process.stderr.write(`[krh-mcp] 오류: ${(err as Error).message}\n`);
  process.exitCode = 1;
});
