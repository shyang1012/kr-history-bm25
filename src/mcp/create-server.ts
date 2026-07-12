/**
 * @Project: kr-history-bm25
 * @File: create-server.ts
 * @Description: MCP 서버 팩토리. 코퍼스(HistoryDb 파사드) 위에 도구·가이드 prompt를 등록한 McpServer를 만든다.
 *               서버 엔트리(server.ts)와 e2e 테스트가 공유한다.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { readPackageVersion } from '../version';
import { MCP_SERVER_NAME } from '../constants';
import type { SearchHanOptions } from '../search/search-han';
import type { SearchKoOptions } from '../search/search-ko';
import type { LookupOptions } from '../search/lookup-place';
import type { ClusterOptions } from '../search/cluster';
import type {
  SearchHit,
  KoSearchHit,
  PlaceOccurrence,
  ClusterNeighbor,
  VariantSearchResult,
  PlaceClusterResult,
  HybridOptions,
  HybridResult,
} from '../types';
import type { ReadingSearchResult } from '../search/search-by-reading';
import type { PlaceClusterOptions } from '../search/place-clusters';
import { registerTools } from './tools';
import { registerGuidePrompt } from './guide';

/**
 * MCP 도구가 소비하는 코퍼스 표면. HistoryDb가 구조적으로 만족한다(테스트는 스텁 주입).
 */
export interface McpCorpus {
  searchHan(term: string, options?: SearchHanOptions): Promise<SearchHit[]>;
  searchKo(term: string, options?: SearchKoOptions): Promise<KoSearchHit[]>;
  lookupPlace(surface: string, options?: LookupOptions): Promise<PlaceOccurrence[]>;
  cluster(surface: string, options?: ClusterOptions): Promise<ClusterNeighbor[]>;
  withVariants(surface: string, options?: SearchHanOptions): Promise<VariantSearchResult>;
  searchByReading(query: string, options?: SearchHanOptions): Promise<ReadingSearchResult>;
  placeClusters(seed: string, options?: PlaceClusterOptions): Promise<PlaceClusterResult>;
  searchHybrid(query: string, options?: HybridOptions): Promise<HybridResult>;
}

/**
 * 코퍼스 위에 도구 7종 + 비정 가이드 prompt를 등록한 McpServer를 만든다.
 * @param corpus - 검색·군집·조회 파사드
 * @returns 연결 준비된 McpServer(transport는 호출자가 연결)
 */
export function createMcpServer(corpus: McpCorpus): McpServer {
  const server = new McpServer({ name: MCP_SERVER_NAME, version: readPackageVersion() });
  registerTools(server, corpus);
  registerGuidePrompt(server);
  return server;
}
