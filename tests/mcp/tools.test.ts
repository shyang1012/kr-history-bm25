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
    placeClusters: async (seed, options) => {
      calls.placeClusters = { seed, options };
      return {
        seed,
        scope: 'article',
        params: { simMin: 0.08, muMin: 0.3, minCooc: 2, limit: 200 },
        truncated: false,
        clusters: [{ clusterId: 0, members: [{ surface: '遼東', type: '지명', membership: 1 }] }],
        noise: [],
      };
    },
    searchHybrid: async (query, options) => {
      calls.searchHybrid = { query, options };
      return {
        query,
        semantic: true,
        hits: [
          { passageId: 4, nodeId: 'n4', corpusCode: 'sg', textHan: `${query}原文`, score: 0.032 },
        ],
      };
    },
    listCorpora: async () => {
      calls.listCorpora = true;
      return [
        {
          code: 'sg',
          name: '삼국사기',
          description: '기전체 정사',
          passageCount: 6086,
          translatedCount: 5733,
          ingestedAt: '2026-07-08T21:22:38.666Z',
        },
        {
          code: 'ko',
          name: '한국고대사료집성',
          description: '25사 동이 관련 기록 발췌·집성',
          passageCount: 19110,
          translatedCount: 0,
          ingestedAt: '2026-07-08T21:23:05.443Z',
        },
      ];
    },
  };
  return { corpus, calls };
}

async function connect(corpus: McpCorpus): Promise<Client> {
  const server = await createMcpServer(corpus);
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
  it('도구 9종이 등록된다', async () => {
    const { corpus } = makeStub();
    const client = await connect(corpus);
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    expect(names).toEqual([
      'cluster',
      'list_corpora',
      'lookup_place',
      'place_clusters',
      'search_by_reading',
      'search_han',
      'search_hybrid',
      'search_ko',
      'with_variants',
    ]);
    await client.close();
  });

  it('list_corpora는 코퍼스 카탈로그를 반환하고 「근거 도구가 아님」을 선언한다', async () => {
    const { corpus, calls } = makeStub();
    const client = await connect(corpus);
    const res = await client.callTool({ name: 'list_corpora', arguments: {} });
    const parsed = JSON.parse(firstText(res)) as {
      note: string;
      corpora: { code: string; description: string | null }[];
    };
    expect(calls.listCorpora).toBe(true);
    expect(parsed.corpora.map((c) => c.code)).toEqual(['sg', 'ko']);
    expect(parsed.corpora[1].description).toContain('발췌');
    // 소비자(extractEvidence)가 근거 축으로 오분류하지 않게 하는 계약
    expect(parsed.note).toContain('검색 결과가 아니');
    await client.close();
  });

  it('corpusCode 설명이 DB 실측 코퍼스에서 생성된다(손유지 문자열 드리프트 차단)', async () => {
    const { corpus } = makeStub();
    const client = await connect(corpus);
    const { tools } = await client.listTools();
    const schema = tools.find((t) => t.name === 'search_han')?.inputSchema as {
      properties: { corpusCode: { description: string } };
    };
    expect(schema.properties.corpusCode.description).toContain('sg=삼국사기');
    expect(schema.properties.corpusCode.description).toContain('ko=한국고대사료집성');
    await client.close();
  });

  it('search_ko 설명이 직역 보유 코퍼스를 실측으로 말한다(하드코딩 아님)', async () => {
    const { corpus } = makeStub();
    const client = await connect(corpus);
    const { tools } = await client.listTools();
    const desc = tools.find((t) => t.name === 'search_ko')?.description ?? '';
    expect(desc).toContain('삼국사기');
    // 직역 0건인 코퍼스는 유효 범위로 광고하지 않는다
    expect(desc).not.toContain('한국고대사료집성');
    await client.close();
  });

  it('place_clusters는 seed·옵션을 전달하고 퍼지 군집을 반환한다', async () => {
    const { corpus, calls } = makeStub();
    const client = await connect(corpus);
    const res = await client.callTool({
      name: 'place_clusters',
      arguments: { seed: '樂浪', scope: 'article', minCooc: 2 },
    });
    const parsed = JSON.parse(firstText(res)) as { seed: string; clusters: unknown[] };
    expect(parsed.seed).toBe('樂浪');
    expect(parsed.clusters.length).toBeGreaterThan(0);
    expect(calls.placeClusters).toEqual({
      seed: '樂浪',
      options: {
        scope: 'article',
        simMin: undefined,
        muMin: undefined,
        minCooc: 2,
        limit: undefined,
      },
    });
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
    expect(rep).toMatchObject({
      reading: '강한찬',
      displayRole: 'dictionary_headword',
      label: '대표음(사전 표제음)',
    });
    expect(conv).toMatchObject({
      reading: '강감찬',
      displayRole: 'conventional_reading',
      label: '관용 독음',
    });
    expect(calls.searchByReading).toEqual({
      query: '강감찬',
      options: { limit: undefined, corpusCode: undefined },
    });
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
    // 동명(同名) 소급 구분 방법론이 가이드에 포함되어야 한다(前朝鮮/後朝鮮·高麗 축약)
    expect(msg.text).toContain('소급 구분');
    expect(msg.text).toContain('前朝鮮');
    await client.close();
  });
});
