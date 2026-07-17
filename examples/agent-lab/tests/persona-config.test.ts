/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/tests/persona-config.test.ts
 * @Description: buildPersona(Task 7)·selectKrhSpec(Task 7 #1 dual-profile) 검증 — persona가
 *   toolInfo 목록·call_mcp 사용법·[id] 인용 규칙을 포함하는지, mode별 krh MCP 스펙 선택이
 *   정확한지(product→npx cmd / undefined·dev→node dist).
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { describe, it, expect } from 'vitest';
import { buildPersona } from '../src/persona';
import { selectKrhSpec } from '../src/config';

describe('buildPersona', () => {
  const toolInfos = [
    { name: 'search_han', description: '한자 원문 검색', inputSchema: {} },
    { name: 'lookup_place', description: '지명 조회', inputSchema: {} },
  ];

  it('주입한 toolInfo name을 포함한다', () => {
    const persona = buildPersona(toolInfos);
    expect(persona).toContain('search_han');
    expect(persona).toContain('lookup_place');
  });

  it('call_mcp 사용법을 언급한다', () => {
    const persona = buildPersona(toolInfos);
    expect(persona).toContain('call_mcp');
  });

  it('[id] 인용 규칙을 언급한다', () => {
    const persona = buildPersona(toolInfos);
    expect(persona).toContain('[id]');
  });
});

describe('selectKrhSpec', () => {
  it("'product' → krhProduct(cmd)", () => {
    expect(selectKrhSpec('product').command).toBe('cmd');
  });

  it('undefined → krhDev(node)', () => {
    expect(selectKrhSpec(undefined).command).toBe('node');
  });

  it("'dev' → krhDev(node)", () => {
    expect(selectKrhSpec('dev').command).toBe('node');
  });
});
