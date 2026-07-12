/**
 * @Project: kr-history-bm25
 * @File: vector-store.ts
 * @Description: 동봉 DB의 passage 의미 벡터(passage_embedding, int8) 로드·양자화·JS cosine 검색. e5-small(384d)
 *               정규화 벡터를 int8(round(v*127))로 저장하고 로드 시 /127 dequant. libsql 벡터함수 미사용(브루트포스).
 *               캐시는 호출측(HistoryDb 인스턴스)이 소유한다(F-07 — 모듈 전역 금지, 연결 격리).
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import type { Client } from '@libsql/client';
import { cosineSim } from './fusion';

/** 임베딩 메타(로드 검증용) */
export interface EmbeddingMeta {
  model: string;
  dim: number;
  quant: string;
}

/** 로드된 벡터 저장소 — kind별 passageId→벡터. meta null이면 벡터 미탑재(코어 폴백) */
export interface VectorStore {
  meta: EmbeddingMeta | null;
  han: Map<number, Float32Array>;
  ko: Map<number, Float32Array>;
}

/** 임베딩 대상 종류 */
export type EmbedKind = 'han' | 'ko';

/**
 * 정규화 벡터를 int8로 양자화한다. round(v*127), [-127,127] 클램프. BLOB 저장용 Uint8Array(int8 바이트) 반환.
 * @param v - 정규화된 임베딩(각 성분 ~[-1,1])
 * @returns int8 바이트(Uint8Array)
 */
export function quantizeInt8(v: Float32Array | number[]): Uint8Array {
  const out = new Int8Array(v.length);
  for (let i = 0; i < v.length; i++) {
    out[i] = Math.max(-127, Math.min(127, Math.round(v[i]! * 127)));
  }
  return new Uint8Array(out.buffer, out.byteOffset, out.byteLength);
}

/**
 * 저장된 BLOB(int8 바이트)을 Float32Array로 dequant한다(v = int8/127).
 * @param blob - libsql BLOB(ArrayBuffer|Uint8Array|Buffer 등)
 * @returns dequant된 Float32Array(길이 = 바이트 수)
 */
export function dequantizeInt8(blob: ArrayBuffer | ArrayBufferView): Float32Array {
  const i8 =
    blob instanceof ArrayBuffer
      ? new Int8Array(blob)
      : new Int8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  const out = new Float32Array(i8.length);
  for (let i = 0; i < i8.length; i++) {
    out[i] = i8[i]! / 127;
  }
  return out;
}

/**
 * 동봉 DB에서 passage 벡터 저장소를 로드한다. embedding_meta로 호환 검증(dim 불일치 시 벡터 미탑재).
 * @param client - libsql 클라이언트
 * @returns VectorStore(meta·han·ko)
 */
export async function loadVectorStore(client: Client): Promise<VectorStore> {
  const store: VectorStore = { meta: null, han: new Map(), ko: new Map() };

  const metaRes = await client.execute('SELECT model, dim, quant FROM embedding_meta WHERE id = 1');
  const metaRow = metaRes.rows[0];
  if (!metaRow) {
    return store; // 벡터 미탑재 → 코어(BM25+사전) 폴백
  }
  store.meta = {
    model: String(metaRow.model),
    dim: Number(metaRow.dim),
    quant: String(metaRow.quant),
  };

  const rows = await client.execute('SELECT passage_id, kind, vec FROM passage_embedding');
  for (const r of rows.rows) {
    const vec = dequantizeInt8(r.vec as ArrayBuffer | ArrayBufferView);
    if (vec.length !== store.meta.dim) {
      continue; // 차원 불일치 벡터는 스킵(호환 방어)
    }
    const map = String(r.kind) === 'ko' ? store.ko : store.han;
    map.set(Number(r.passage_id), vec);
  }
  return store;
}

/**
 * 질의 벡터와 저장 벡터의 cosine top-K passageId를 반환한다(정렬: cosine 내림차순, 동점 passageId ASC).
 * @param qVec - 정규화된 질의 벡터
 * @param vecs - passageId→벡터
 * @param k - 상한
 * @returns passageId 배열(cosine 내림차순, ≤k)
 */
export function vectorRank(
  qVec: Float32Array,
  vecs: Map<number, Float32Array>,
  k: number,
): number[] {
  const scored: { id: number; s: number }[] = [];
  for (const [id, v] of vecs) {
    scored.push({ id, s: cosineSim(qVec, v) });
  }
  scored.sort((a, b) => (b.s !== a.s ? b.s - a.s : a.id - b.id));
  return scored.slice(0, Math.max(0, k)).map((x) => x.id);
}
