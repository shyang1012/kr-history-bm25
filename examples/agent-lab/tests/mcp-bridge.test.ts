/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/mcp-bridge.test.ts
 * @Description: McpBridge(Task 4) 검증 — 미등록 서버 callTool의 에러 정규화, listTools 빈 상태,
 *   그리고 isError 정규화 순수 헬퍼 normalizeToolResult의 단위 계약.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect } from 'vitest';
import { McpBridge, normalizeToolResult } from '../src/mcp-bridge';

describe('McpBridge', () => {
  it('미등록 서버 callTool은 error 정규화', async () => {
    const b = new McpBridge();
    const r = await b.callTool('nope', 'search_han', {});
    expect(r).toHaveProperty('error');
  });

  it('연결 없이 listTools()는 빈 배열', () => {
    const b = new McpBridge();
    expect(b.listTools()).toEqual([]);
  });
});

describe('normalizeToolResult', () => {
  it('isError:true는 error 프로퍼티로 정규화되며 content를 보존', () => {
    const r = normalizeToolResult({ isError: true, content: [{ type: 'text', text: 'boom' }] });
    expect(r).toHaveProperty('error');
    expect(r).toMatchObject({ content: [{ type: 'text', text: 'boom' }] });
  });

  it('isError 없는 정상 결과는 그대로 passthrough', () => {
    const input = { content: [{ type: 'text', text: '[]' }] };
    const r = normalizeToolResult(input);
    expect(r).not.toHaveProperty('error');
    expect(r).toEqual(input);
  });
});
