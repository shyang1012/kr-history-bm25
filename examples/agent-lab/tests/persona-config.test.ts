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
import { selectKrhSpec, parseThink } from '../src/config';

describe('buildPersona', () => {
  it('역할(역사학자 조교)·call_mcp·[id] 인용 규칙을 언급한다', () => {
    const persona = buildPersona();
    expect(persona).toContain('역사학자');
    expect(persona).toContain('call_mcp');
    expect(persona).toContain('[id]');
  });

  // 진단 D(2026-07-17): 시스템 프롬프트에 도구 목록을 텍스트로 나열하면 모델이 호출을 tool_calls가
  // 아니라 content로 흘린다 → 도구 설명은 call_mcp 함수 스키마 description이 담당하고 persona는
  // 목록을 넣지 않는다. (구체 도구명이 persona에 없음을 회귀로 고정.)
  it('도구 목록을 나열하지 않는다(함수 스키마가 담당)', () => {
    const persona = buildPersona();
    expect(persona).not.toContain('search_han');
    expect(persona).not.toContain('place_clusters');
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

describe('parseThink', () => {
  it("'true' → true", () => {
    expect(parseThink('true')).toBe(true);
  });
  it("'false' → false", () => {
    expect(parseThink('false')).toBe(false);
  });
  it('undefined·기타 → undefined(OpenAI 호환)', () => {
    expect(parseThink(undefined)).toBeUndefined();
    expect(parseThink('yes')).toBeUndefined();
  });
});
