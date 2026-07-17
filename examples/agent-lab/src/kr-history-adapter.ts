/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/kr-history-adapter.ts
 * @Description: kr-history 접지 어댑터(도메인) — krh-mcp 도구별 결과 → Evidence 추출. call_mcp의
 *   extractEvidence 콜백으로 주입된다. 이 파일만 krh-mcp 도구별 반환 구조(SearchHit·ClusterNeighbor·
 *   PlaceClusterResult 등)를 안다 — 범용 코어(call-mcp-tool.ts)는 도메인을 모른다(R6 격리).
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import type { Evidence } from './grounding';

/** krh-mcp CallToolResult 최소 형상(텍스트 content[0]만 사용). */
interface McpTextResult {
  content?: { type?: string; text?: string }[];
}

/** search_han/search_ko(SearchHit·KoSearchHit) 최소 형상. */
interface SearchHitLike {
  passageId?: number;
  textHan?: string;
}

/** with_variants(VariantSearchResult)·search_hybrid(HybridResult)·search_by_reading 래핑 형상. */
interface HitsWrapper {
  hits?: SearchHitLike[];
}

/** lookup_place(PlaceOccurrence) 최소 형상. */
interface PlaceOccurrenceLike {
  passageId?: number;
}

/** cluster(ClusterNeighbor) 최소 형상. */
interface ClusterNeighborLike {
  surface?: string;
}

/** place_clusters(PlaceClusterResult) 최소 형상. */
interface PlaceClusterResultLike {
  clusters?: { members?: { surface?: string }[] }[];
}

/** mcpResult.content[0].text를 JSON으로 파싱한다. 형상 이상·파싱 실패 시 null. */
function parseMcpText(mcpResult: unknown): unknown {
  if (typeof mcpResult !== 'object' || mcpResult === null) {
    return null;
  }
  const text = (mcpResult as McpTextResult).content?.[0]?.text;
  if (typeof text !== 'string') {
    return null;
  }
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** 배열 직접 반환(search_han 등)과 {hits} 래핑(with_variants 등)을 통일한다. */
function hitsOf(json: unknown): SearchHitLike[] {
  if (Array.isArray(json)) {
    return json as SearchHitLike[];
  }
  const wrapped = (json as HitsWrapper).hits;
  return Array.isArray(wrapped) ? wrapped : [];
}

/**
 * krh-mcp 도구 결과를 도구별 형상에 맞춰 Evidence[]로 정규화한다. 파싱 실패·미지원 도구는 빈 배열.
 *
 * @param toolName call_mcp로 호출된 도구 이름
 * @param mcpResult call_mcp handler가 반환한 원본 CallToolResult
 * @returns 접지 검증에 제공할 근거 목록
 */
export function krHistoryExtractEvidence(toolName: string, mcpResult: unknown): Evidence[] {
  const json = parseMcpText(mcpResult);
  if (json === null) {
    return [];
  }

  switch (toolName) {
    case 'search_han':
    case 'search_ko':
    case 'with_variants':
    case 'search_hybrid':
    case 'search_by_reading':
      return hitsOf(json).map((h) => ({ passageId: h.passageId, hanSurface: h.textHan ?? '' }));
    case 'lookup_place':
      return (json as PlaceOccurrenceLike[]).map((o) => ({
        passageId: o.passageId,
        hanSurface: '',
      }));
    case 'cluster':
      return (json as ClusterNeighborLike[]).map((n) => ({ hanSurface: n.surface ?? '' }));
    case 'place_clusters': {
      const clusters = (json as PlaceClusterResultLike).clusters ?? [];
      return clusters.flatMap((c) =>
        (c.members ?? []).map((m) => ({ hanSurface: m.surface ?? '' })),
      );
    }
    default:
      return [];
  }
}
