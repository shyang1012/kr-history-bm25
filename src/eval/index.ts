/**
 * @Project: kr-history-bm25
 * @File: index.ts
 * @Description: eval 모듈 배럴 — 하이브리드 융합(RRF·cosine)과 랭킹 지표(Recall@K·RR·nDCG). krh-cvh Phase 0
 *               평가 하니스가 dist/eval/index.js로 import한다. 공개 패키지 배럴(src/index.ts)에는 미노출(내부 dev).
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
export { rrf, cosineSim, type FusionScore } from './fusion';
export { recallAtK, hitAtK, reciprocalRank, ndcgAtK, mean } from './metrics';
