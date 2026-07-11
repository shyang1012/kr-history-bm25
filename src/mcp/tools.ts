/**
 * @Project: kr-history-bm25
 * @File: tools.ts
 * @Description: MCP 도구 6종 등록 — search_han/search_ko/lookup_place/cluster/with_variants/search_by_reading.
 *               HistoryDb 파사드에 1:1 매핑하는 얇은 어댑터. 결과는 JSON 텍스트로 반환한다.
 *               도구 설명에 사용 지침(고유명사→han / 사건·서술어→ko)을 인코딩해 LLM 선택을 돕는다.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpCorpus } from './create-server';
import { readingDisplay, type ReadingSearchResult } from '../search/search-by-reading';

/**
 * reading 검색 결과를 LLM-facing 계약으로 변환한다. 각 매칭 개체의 대표음·관용을 의미 필드
 * (displayRole·label·source)와 함께 노출해, 사전 채택 검색 기준값과 프로젝트 해석을 구분하게 한다.
 */
function readingResult(r: ReadingSearchResult): unknown {
  return {
    query: r.query,
    matches: r.matches.map((m) => {
      const readings: unknown[] = [];
      if (m.original !== null) {
        readings.push({
          reading: m.original,
          readingType: 'original',
          ...readingDisplay('original'),
          source: m.originalSource,
        });
      }
      if (m.conventional !== null) {
        readings.push({
          reading: m.conventional,
          readingType: 'conventional',
          ...readingDisplay('conventional'),
        });
      }
      return {
        surface: m.surface,
        type: m.type,
        ...(m.simplified ? { simplified: m.simplified } : {}),
        readings,
      };
    }),
    surfaces: r.surfaces,
    hits: r.hits,
  };
}

/** 도구 결과를 JSON 텍스트 CallToolResult로 감싼다 */
function jsonResult(data: unknown): {
  content: { type: 'text'; text: string }[];
} {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] };
}

/** 공통 옵션 스키마 조각 */
const limitSchema = z
  .number()
  .int()
  .positive()
  .max(200)
  .optional()
  .describe('최대 결과 수(기본 20)');
const corpusCodeSchema = z
  .string()
  .optional()
  .describe('코퍼스 코드로 제한(sg=삼국사기·sy=삼국유사·kr=고려사·kj=고려사절요·ko=고대사료집성)');

/**
 * 코퍼스 도구 5종을 서버에 등록한다.
 * @param server - McpServer
 * @param corpus - 검색·군집·조회 파사드
 */
export function registerTools(server: McpServer, corpus: McpCorpus): void {
  server.registerTool(
    'search_han',
    {
      title: '한자 원문 BM25 검색',
      description:
        '한자 원문을 BM25로 검색한다. 지명·인명·관직·서명 등 고유명사 검색에 사용한다(한자가 신뢰 근거). ' +
        '간자체(简体) 질의도 자동으로 정자(번체) 후보로 확장해 검색한다(중국어권 연구자 지원). ' +
        '사건·현상·서술어는 search_ko를 쓴다. score는 작을수록 관련이 높다.',
      inputSchema: {
        term: z.string().min(1).describe('검색어(한자)'),
        limit: limitSchema,
        corpusCode: corpusCodeSchema,
      },
    },
    async ({ term, limit, corpusCode }) =>
      jsonResult(await corpus.searchHan(term, { limit, corpusCode })),
  );

  server.registerTool(
    'search_ko',
    {
      title: '직역(보조) BM25 검색',
      description:
        '우리가 직접 직역한 한국어 보조 인덱스를 BM25로 검색한다. 일식·전쟁·항복 등 사건·현상·서술어에 사용한다. ' +
        '번역 완료 코퍼스(삼국사기·삼국유사)에서만 유효하다. 고유명사는 search_han을 쓴다.',
      inputSchema: {
        term: z.string().min(1).describe('검색어(한국어)'),
        limit: limitSchema,
      },
    },
    async ({ term, limit }) => jsonResult(await corpus.searchKo(term, { limit })),
  );

  server.registerTool(
    'lookup_place',
    {
      title: '표기 출현 위치 조회',
      description: '지명·인명 등 표기가 등장한 위치(코퍼스·노드·경로)를 구조화 색인으로 조회한다.',
      inputSchema: {
        surface: z.string().min(1).describe('표기(한자)'),
        type: z.string().optional().describe('개체 유형 제한(지명/이름 등)'),
        limit: limitSchema,
      },
    },
    async ({ surface, type, limit }) =>
      jsonResult(await corpus.lookupPlace(surface, { type, limit })),
  );

  server.registerTool(
    'cluster',
    {
      title: '공기(共起) 군집',
      description:
        '대상 표기와 선택한 scope(article=기사/paragraph=문단) 단위로 함께 등장하는 개체를 공기 빈도순으로 반환한다. ' +
        '지명 비정은 단독 비교가 아니라 이 군집으로 판단한다.',
      inputSchema: {
        surface: z.string().min(1).describe('대상 표기(한자)'),
        type: z.string().optional().describe('대상 개체 유형 제한'),
        neighborType: z.string().optional().describe('이웃 개체 유형 제한(예: 지명)'),
        scope: z
          .enum(['article', 'paragraph'])
          .optional()
          .describe('공기 범위: article=기사(기본), paragraph=문단으로 좁힘'),
        limit: limitSchema,
      },
    },
    async ({ surface, type, neighborType, scope, limit }) =>
      jsonResult(await corpus.cluster(surface, { type, neighborType, scope, limit })),
  );

  server.registerTool(
    'with_variants',
    {
      title: '이표기 확장 검색',
      description:
        '이표기 그룹(예: 졸본=홀본)을 확장해 모든 표기를 함께 한자 검색한다. 확장된 표기 목록과 병합 결과를 반환한다.',
      inputSchema: {
        surface: z.string().min(1).describe('대상 표기(한자)'),
        limit: limitSchema,
        corpusCode: corpusCodeSchema,
      },
    },
    async ({ surface, limit, corpusCode }) =>
      jsonResult(await corpus.withVariants(surface, { limit, corpusCode })),
  );

  server.registerTool(
    'search_by_reading',
    {
      title: '독음(한글)으로 한자 원문 검색',
      description:
        '한글 독음으로 한자 표기를 찾아 원문을 검색한다(예: "강감찬"→姜邯贊). 채택 독음을 역매칭해 이표기까지 확장한다. ' +
        '반환의 대표음(사전 표제음)·관용 독음은 근거 사전에서 채택한 검색 기준값이며 프로젝트의 역사 해석이 아니다.',
      inputSchema: {
        query: z.string().min(1).describe('독음(한글, 예: 강감찬)'),
        limit: limitSchema,
        corpusCode: corpusCodeSchema,
      },
    },
    async ({ query, limit, corpusCode }) =>
      jsonResult(readingResult(await corpus.searchByReading(query, { limit, corpusCode }))),
  );
}
