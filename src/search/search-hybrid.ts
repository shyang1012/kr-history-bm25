/**
 * @Project: kr-history-bm25
 * @File: search-hybrid.ts
 * @Description: 하이브리드 검색 — 한자 BM25(+간자 확장)·독음 사전·직역 BM25·원문/직역 벡터를 가중 RRF로 융합한다.
 *               정확 층(BM25·사전) 위 발견 층(벡터). 사전·BM25 authoritative(높은 가중), 벡터는 recall 보강(F-05).
 *               벡터 미탑재 DB나 semantic=false면 코어(BM25+사전)로 자동 폴백. 벡터 저장소는 호출측(HistoryDb)이
 *               인스턴스 단위로 캐시해 주입한다(F-07). Phase 0 근거: 사전 authoritative·직역 벡터>원문 벡터.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import type { Client } from '@libsql/client';
import { searchHan } from './search-han';
import { searchKo } from './search-ko';
import { searchByReading } from './search-by-reading';
import { weightedRrf, type WeightedList } from './fusion';
import { vectorRank, type VectorStore } from './vector-store';
import { embedQuery } from './embedder';
import type { HybridHit, HybridOptions, HybridResult, HybridWeights } from '../types';

/** arm 기본 가중 — 사전(reading)·BM25 authoritative > 벡터(recall). 직역 벡터 > 원문 벡터(Phase 0) */
export const DEFAULT_WEIGHTS: HybridWeights = {
  han: 2,
  reading: 3,
  ko: 2,
  vecHan: 1,
  vecKo: 1.5,
};

/** 융합 top passageId → passage 상세(한자 원문·노드·코퍼스) 조회 */
async function hydrate(
  client: Client,
  ids: number[],
): Promise<Map<number, Omit<HybridHit, 'score'>>> {
  const map = new Map<number, Omit<HybridHit, 'score'>>();
  if (ids.length === 0) {
    return map;
  }
  const placeholders = ids.map(() => '?').join(', ');
  const res = await client.execute({
    sql: `
      SELECT p.id AS passage_id, p.node_id AS node_id, c.code AS corpus_code, p.text_han AS text_han
        FROM passage p
        JOIN corpus c ON c.id = p.corpus_id
       WHERE p.id IN (${placeholders})`,
    args: ids,
  });
  for (const r of res.rows) {
    map.set(Number(r.passage_id), {
      passageId: Number(r.passage_id),
      nodeId: String(r.node_id),
      corpusCode: String(r.corpus_code),
      textHan: String(r.text_han),
    });
  }
  return map;
}

/**
 * 하이브리드 검색을 수행한다.
 * @param client - libsql 클라이언트
 * @param query - 검색어(한자·한글 독음·개념·간자체)
 * @param store - 로드된 벡터 저장소(HistoryDb가 캐시·주입). meta null이면 코어 폴백
 * @param options - limit·semantic·corpusCode·retrieveK·weights
 * @returns 융합 순위 결과(semantic=벡터 arm 실사용 여부)
 */
export async function searchHybrid(
  client: Client,
  query: string,
  store: VectorStore,
  options: HybridOptions = {},
): Promise<HybridResult> {
  const limit = options.limit ?? 20;
  const K = options.retrieveK ?? 200;
  const w = { ...DEFAULT_WEIGHTS, ...(options.weights ?? {}) };
  const useSemantic = (options.semantic ?? true) && store.meta !== null;

  // 렉시컬·사전 arm(기존 검색 함수 재사용 — 사전 로직 캡슐화)
  const [hanHits, reading, koHits] = await Promise.all([
    searchHan(client, query, { limit: K, corpusCode: options.corpusCode }),
    searchByReading(client, query, { limit: K, corpusCode: options.corpusCode }),
    searchKo(client, query, { limit: K }),
  ]);

  const arms: WeightedList<number>[] = [
    { items: hanHits.map((h) => h.passageId), weight: w.han },
    { items: reading.hits.map((h) => h.passageId), weight: w.reading },
    { items: koHits.map((h) => h.passageId), weight: w.ko },
  ];

  // 벡터(의미) arm — 질의 임베딩 + cosine top-K
  if (useSemantic) {
    const qVec = await embedQuery(query);
    arms.push({ items: vectorRank(qVec, store.han, K), weight: w.vecHan });
    arms.push({ items: vectorRank(qVec, store.ko, K), weight: w.vecKo });
  }

  const fused = weightedRrf(arms);
  const scoreOf = new Map(fused.map((f) => [f.item, f.score]));
  const topIds = fused.slice(0, limit).map((f) => f.item);
  const detail = await hydrate(client, topIds);

  const hits: HybridHit[] = topIds
    .map((id) => {
      const d = detail.get(id);
      if (!d) {
        return null;
      }
      return { ...d, score: Number((scoreOf.get(id) ?? 0).toFixed(6)) };
    })
    .filter((h): h is HybridHit => h !== null);

  return { query, semantic: useSemantic, hits };
}
