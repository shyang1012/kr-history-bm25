/**
 * @Project: kr-history-bm25
 * @File: tools.test.ts
 * @Description: MCP 도구 계약 단위 검증 — 스텁 코퍼스로 도구 등록·JSON 반환·인자 전달을 확인한다(동봉 DB 불필요).
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import { describe, it, expect } from 'vitest';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { createMcpServer, type McpCorpus } from '../../src/mcp/create-server';
import { GUIDE_PROMPT_NAME } from '../../src/mcp/guide';

/** 인자를 되돌려주는 스텁 코퍼스(호출 인자 검증용) */
function makeStub(): { corpus: McpCorpus; calls: Record<string, unknown> } {
  const calls: Record<string, unknown> = {};
  const corpus: McpCorpus = {
    searchHan: async (term, options) => {
      calls.searchHan = { term, options };
      return [
        { passageId: 1, nodeId: 'n1', corpusCode: 'sg', textHan: `${term}原文`, score: -1.5 },
      ];
    },
    searchKo: async (term, options) => {
      calls.searchKo = { term, options };
      return [
        {
          passageId: 2,
          nodeId: 'n2',
          corpusCode: 'sg',
          textHan: '原文',
          score: -1,
          koText: `${term} 직역`,
        },
      ];
    },
    lookupPlace: async (surface, options) => {
      calls.lookupPlace = { surface, options };
      return [{ passageId: 3, nodeId: 'n3', corpusCode: 'sy', nodeTitle: '제목', path: '/a/b' }];
    },
    cluster: async (surface, options) => {
      calls.cluster = { surface, options };
      return [{ type: '지명', surface: '이웃', count: 7 }];
    },
    withVariants: async (surface, options) => {
      calls.withVariants = { surface, options };
      return { surfaces: [surface, '홀본'], hits: [] };
    },
    searchByReading: async (query, options) => {
      calls.searchByReading = { query, options };
      return {
        query,
        matches: [
          {
            entityId: 1,
            surface: '姜邯贊',
            type: '이름',
            original: '강한찬',
            conventional: '강감찬',
            originalSource: 'synth',
          },
        ],
        surfaces: ['姜邯贊'],
        hits: [],
      };
    },
  };
  return { corpus, calls };
}

async function connect(corpus: McpCorpus): Promise<Client> {
  const server = createMcpServer(corpus);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '0.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  return client;
}

function firstText(result: { content?: unknown }): string {
  const content = result.content as { type: string; text: string }[];
  return content[0].text;
}

describe('MCP tools', () => {
  it('도구 6종이 등록된다', async () => {
    const { corpus } = makeStub();
    const client = await connect(corpus);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'cluster',
      'lookup_place',
      'search_by_reading',
      'search_han',
      'search_ko',
      'with_variants',
    ]);
    await client.close();
  });

  it('search_han은 파사드 결과를 JSON 텍스트로 반환하고 인자를 전달한다', async () => {
    const { corpus, calls } = makeStub();
    const client = await connect(corpus);
    const res = await client.callTool({
      name: 'search_han',
      arguments: { term: '浿水', limit: 5, corpusCode: 'sg' },
    });
    const parsed = JSON.parse(firstText(res)) as { textHan: string }[];
    expect(parsed[0].textHan).toContain('浿水');
    expect(calls.searchHan).toEqual({ term: '浿水', options: { limit: 5, corpusCode: 'sg' } });
    await client.close();
  });

  it('search_by_reading은 대표음·관용을 displayRole·label과 함께 반환한다', async () => {
    const { corpus, calls } = makeStub();
    const client = await connect(corpus);
    const res = await client.callTool({
      name: 'search_by_reading',
      arguments: { query: '강감찬' },
    });
    const parsed = JSON.parse(firstText(res)) as {
      matches: {
        surface: string;
        readings: { reading: string; readingType: string; displayRole: string; label: string }[];
      }[];
    };
    expect(parsed.matches[0].surface).toBe('姜邯贊');
    const rep = parsed.matches[0].readings.find((r) => r.readingType === 'original');
    const conv = parsed.matches[0].readings.find((r) => r.readingType === 'conventional');
    expect(rep).toMatchObject({ reading: '강한찬', displayRole: 'dictionary_headword', label: '대표음(사전 표제음)' });
    expect(conv).toMatchObject({ reading: '강감찬', displayRole: 'conventional_reading', label: '관용 독음' });
    expect(calls.searchByReading).toEqual({ query: '강감찬', options: { limit: undefined, corpusCode: undefined } });
    await client.close();
  });

  it('cluster는 neighborType 인자를 전달한다', async () => {
    const { corpus, calls } = makeStub();
    const client = await connect(corpus);
    const res = await client.callTool({
      name: 'cluster',
      arguments: { surface: '卒本', neighborType: '지명' },
    });
    const parsed = JSON.parse(firstText(res)) as { surface: string }[];
    expect(parsed[0].surface).toBe('이웃');
    expect(calls.cluster).toEqual({
      surface: '卒本',
      options: { type: undefined, neighborType: '지명', limit: undefined },
    });
    await client.close();
  });

  it('비정 가이드 prompt가 등록되고 본문을 반환한다', async () => {
    const { corpus } = makeStub();
    const client = await connect(corpus);
    const { prompts } = await client.listPrompts();
    expect(prompts.map((p) => p.name)).toContain(GUIDE_PROMPT_NAME);

    const got = await client.getPrompt({ name: GUIDE_PROMPT_NAME });
    const msg = got.messages[0].content as { type: string; text: string };
    expect(msg.text).toContain('비정');
    await client.close();
  });
});
