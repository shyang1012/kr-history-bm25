/**
 * @Project: kr-history-bm25
 * @File: tools.ts
 * @Description: MCP 도구 9종 등록 — list_corpora/search_han/search_ko/search_hybrid/search_by_reading/
 *               lookup_place/cluster/with_variants/place_clusters.
 *               HistoryDb 파사드에 1:1 매핑하는 얇은 어댑터. 결과는 JSON 텍스트로 반환한다.
 *               도구 설명에 사용 지침(고유명사→han / 사건·서술어→ko)을 인코딩해 LLM 선택을 돕는다.
 *               🔴 코퍼스 코드·직역 보유 현황은 손유지 문자열이 아니라 DB 실측 카탈로그에서 생성한다(krh-i2o).
 * @Author: shyang
 * @LastModified: 2026-08-21
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import type { McpCorpus } from './create-server';
import type { CorpusInfo } from '../corpus/list-corpora';
import { describeCorpusCodes, describeTranslatedCorpora } from '../corpus/corpus-registry';
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

/** list_corpora가 근거(evidence) 도구로 오분류되지 않게 하는 계약 문구 */
const CATALOG_NOTE =
  '이것은 검색 결과가 아니라 코퍼스 카탈로그다. 인용·근거는 search_* 도구 결과로만 제시하고, ' +
  '신뢰 근거는 언제나 한자 원문이다.';

/** 직역 보유 현황 문장(카탈로그가 비면 빈 문자열) */
function translatedHint(catalog: readonly CorpusInfo[]): string {
  const hint = describeTranslatedCorpora(catalog);
  return hint === '' ? '' : ` 직역 보유(채택/전체): ${hint}.`;
}

/**
 * 코퍼스 도구 9종을 서버에 등록한다.
 * @param server - McpServer
 * @param corpus - 검색·군집·조회·카탈로그 파사드
 * @param catalog - 기동 시 조회한 코퍼스 카탈로그(도구 설명 생성용 스냅샷)
 */
export function registerTools(
  server: McpServer,
  corpus: McpCorpus,
  catalog: readonly CorpusInfo[] = [],
): void {
  const corpusCodeSchema = z.string().optional().describe(describeCorpusCodes(catalog));
  const koScope = translatedHint(catalog);

  server.registerTool(
    'list_corpora',
    {
      title: '코퍼스 카탈로그(무엇이 들어 있는가)',
      description:
        '이 서버가 담고 있는 사서 목록과 각 사서의 성격·수록 건수·직역 보유 현황을 반환한다. ' +
        '🔴 검색 결과가 아니다 — 근거(evidence) 도구가 아니라 카탈로그다. ' +
        '출처의 성격(1차 사료인지, 어느 시대·어느 관찰 위치의 기록인지)을 추측하지 말고 이 도구로 확인한다.',
      inputSchema: {},
    },
    async () => jsonResult({ note: CATALOG_NOTE, corpora: await corpus.listCorpora() }),
  );

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
        '직역이 적재된 범위에서만 유효하다(전체 코퍼스는 list_corpora로 확인). 고유명사는 search_han을 쓴다.' +
        koScope,
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

  server.registerTool(
    'place_clusters',
    {
      title: '지명 국소 퍼지 군집(FDBSCAN)',
      description:
        'seed 지명의 공기(共起) 국소 네트워크를 퍼지 밀도 군집한다. 경계 지명은 여러 군집에 소속도로 분할된다. ' +
        '🔴 소속도는 "비정 가능성 등급"이지 확정이 아니다. 전역 밀도가 아니라 seed 유도 국소 분석이며 판단은 연구자 몫.',
      inputSchema: {
        seed: z.string().min(1).describe('기준 지명(한자)'),
        scope: z
          .enum(['article', 'paragraph'])
          .optional()
          .describe('공기 범위: article=기사(기본), paragraph=문단'),
        parameterMode: z
          .enum(['fixed', 'auto'])
          .optional()
          .describe(
            'fixed(기본)|auto(seed별 자동 산정 — 희소·고빈도 seed 적응, 선정근거 selection 반환)',
          ),
        simMin: z
          .number()
          .positive()
          .optional()
          .describe('soft eps(이웃 유사도 하한). fixed 전용 — auto 모드에서는 무시됨'),
        muMin: z
          .number()
          .positive()
          .optional()
          .describe('코어 밀도 하한. fixed 전용 — auto 모드에서는 무시됨'),
        minCooc: z
          .number()
          .int()
          .positive()
          .optional()
          .describe('엣지 컷(최소 공기 수). fixed 전용 — auto 모드에서는 자동 산정됨'),
        limit: z.number().int().positive().max(1000).optional().describe('seed 이웃(U) 상한'),
      },
    },
    async ({ seed, scope, parameterMode, simMin, muMin, minCooc, limit }) =>
      jsonResult(
        await corpus.placeClusters(seed, { scope, parameterMode, simMin, muMin, minCooc, limit }),
      ),
  );

  server.registerTool(
    'search_hybrid',
    {
      title: '하이브리드 검색(BM25+사전+벡터)',
      description:
        '한자 BM25·독음/간자 사전·직역 BM25·의미 벡터를 가중 융합해 검색한다(정확 층 위 발견 층). ' +
        '고유명사·개념·한글 독음·간자체 질의 모두 한 창구로 처리하며, 사전이 authoritative(우선)하고 벡터는 ' +
        '맥락 recall을 보강한다. 의미 벡터는 직역·임베딩이 적재된 범위에서 동작한다. score는 클수록 관련이 높다.' +
        koScope,
      inputSchema: {
        query: z.string().min(1).describe('검색어(한자·한글 독음·개념·간자체)'),
        limit: limitSchema,
        corpusCode: corpusCodeSchema,
        semantic: z
          .boolean()
          .optional()
          .describe('의미(벡터) arm 사용(기본 true). false면 BM25+사전 코어만'),
      },
    },
    async ({ query, limit, corpusCode, semantic }) =>
      jsonResult(await corpus.searchHybrid(query, { limit, corpusCode, semantic })),
  );
}
