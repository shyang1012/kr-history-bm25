/**
 * @Project: kr-history-bm25
 * @File: embedder.ts
 * @Description: 질의 임베더 — 동봉 e5-small(양자화 ONNX)을 transformers.js로 lazy 로드해 검색어를 384d 벡터로
 *               임베딩한다. 🔴 로컬 모델만 사용(env.allowRemoteModels=false, localModelPath=패키지 내 models/) —
 *               네트워크 다운로드 0(F-03). 엔진(@huggingface/transformers)은 런타임 의존성. e5 규약: 'query: '
 *               프리픽스 + mean pooling + L2 정규화. 파사드가 인스턴스 단위로 캐시한다(F-07은 벡터 저장소 측).
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync } from 'node:fs';

/** 동봉 임베딩 모델 식별자(models/ 하위 경로로 해석) */
export const MODEL_ID = 'Xenova/multilingual-e5-small';
/** 벡터 차원 */
export const EMBED_DIM = 384;

const MODEL_SUBPATH = join('models', ...MODEL_ID.split('/'));

/**
 * 모듈 위치에서 상위로 올라가며 동봉 models/ 루트를 찾는다(dist·설치본 진입점 차이 흡수, findDataDir와 동형).
 * @returns models 디렉터리 절대 경로
 */
export function findModelsDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    if (existsSync(join(dir, MODEL_SUBPATH))) {
      return join(dir, 'models');
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    '동봉 임베딩 모델(models/Xenova/multilingual-e5-small)을 찾을 수 없습니다. 패키지 손상 또는 files 누락.',
  );
}

/** 질의 → 정규화 384d 벡터 */
export type QueryEmbedder = (text: string) => Promise<Float32Array>;

let embedderPromise: Promise<QueryEmbedder> | null = null;

/**
 * 질의 임베더를 lazy 로드한다(1회 로드·캐시). 로컬 모델만 사용(원격 차단).
 * @returns 질의 임베딩 함수
 */
export function loadQueryEmbedder(): Promise<QueryEmbedder> {
  if (!embedderPromise) {
    embedderPromise = init();
  }
  return embedderPromise;
}

async function init(): Promise<QueryEmbedder> {
  const tf = await import('@huggingface/transformers');
  tf.env.allowRemoteModels = false; // 🔴 다운로드 금지 — 동봉 모델만
  tf.env.allowLocalModels = true;
  tf.env.localModelPath = findModelsDir();
  // 양자화(q8) ONNX 로드 — 번들엔 model_quantized.onnx만 동봉(fp32는 449MB로 제외)
  const extractor = await tf.pipeline('feature-extraction', MODEL_ID, { dtype: 'q8' });
  return async (text: string): Promise<Float32Array> => {
    const out = await extractor(['query: ' + text], { pooling: 'mean', normalize: true });
    return Float32Array.from((out.tolist() as number[][])[0]!);
  };
}

/**
 * 검색어를 임베딩한다(lazy 로드 후).
 * @param text - 검색어
 * @returns 정규화 384d 벡터
 */
export async function embedQuery(text: string): Promise<Float32Array> {
  const embed = await loadQueryEmbedder();
  return embed(text);
}
