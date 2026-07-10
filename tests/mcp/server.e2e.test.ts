/**
 * @Project: kr-history-bm25
 * @File: server.e2e.test.ts
 * @Description: MCP 서버 e2e — 실제 동봉 코퍼스를 열고 in-memory 클라이언트로 도구를 호출해 배포 산출물 계약을 검증한다.
 *               data/history.sqlite.gz 있을 때만 실행. 격리 targetDir로 작업 DB를 건드리지 않는다.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import { describe, it, expect, afterAll } from 'vitest';
import { existsSync, rmSync, mkdtempSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { openBundledDb } from '../../src/bundled-db';
import { createMcpServer } from '../../src/mcp/create-server';
import { GUIDE_PROMPT_NAME } from '../../src/mcp/guide';

const gzPath = fileURLToPath(new URL('../../data/history.sqlite.gz', import.meta.url));
const hasBundle = existsSync(gzPath);
const workDir = mkdtempSync(join(tmpdir(), 'krh-mcp-e2e-'));

afterAll(() => {
  try {
    rmSync(workDir, { recursive: true, force: true });
  } catch {
    /* Windows sqlite 락 — 임시폴더 정리 실패 무시 */
  }
});

describe.skipIf(!hasBundle)('MCP server e2e (동봉 코퍼스)', () => {
  it('도구 5종을 노출하고 search_han이 실제 결과를 반환한다', async () => {
    const db = await openBundledDb({ targetDir: workDir });
    const server = createMcpServer(db);
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'e2e-client', version: '0.0.0' });
    await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);

    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      'cluster',
      'lookup_place',
      'search_han',
      'search_ko',
      'with_variants',
    ]);

    const res = await client.callTool({
      name: 'search_han',
      arguments: { term: '卒本', limit: 3 },
    });
    const content = res.content as { type: string; text: string }[];
    const hits = JSON.parse(content[0].text) as { textHan: string }[];
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].textHan).toContain('卒本');

    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain(GUIDE_PROMPT_NAME);

    await client.close();
    db.close();
  });
});
