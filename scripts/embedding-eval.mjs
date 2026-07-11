/**
 * @Project: kr-history-bm25
 * @File: embedding-eval.mjs
 * @Description: krh-cvh Phase 0 — 하이브리드 검색 오프라인 평가 하니스. multilingual-e5-small로 sg/sy passage를
 *               원문·직역 각각 임베딩(문맥 청크=passage)한 뒤, 6개 arm(한자BM25/직역BM25/사전+BM25/원문벡터/
 *               직역벡터/RRF융합)을 정답셋(eval/relevance.json)에 대조해 Recall@K·MRR·nDCG를 산출한다.
 *               char-pair(eval/char-pairs.json) cosine로 정자↔간자·한자음·개념 의미공간도 측정한다.
 *               리랭커 arm(rr-han/rr-ko)은 --reranker일 때만(오프라인 bge-reranker-base, 외부 전송 없음). 결과는
 *               tmp/embedding-eval.json + 콘솔 요약. 리랭커 제외 전부 결정론.
 *               실행: npm run build 후 `node scripts/embedding-eval.mjs [--reranker]`.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { createClient } from '@libsql/client';
import {
  pipeline,
  AutoTokenizer,
  AutoModelForSequenceClassification,
} from '@huggingface/transformers';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { openBundledDb } from '../dist/index.js';
import { rrf, cosineSim, recallAtK, reciprocalRank, ndcgAtK, mean } from '../dist/eval/index.js';

const MODEL = 'Xenova/multilingual-e5-small';
const RERANK_MODEL = 'Xenova/bge-reranker-base';
const RERANK_TOPN = 30; // 리랭크 대상 하이브리드 상위 후보 수
const DIM = 384;
const UNIVERSE = ['sg', 'sy']; // 원문+직역이 모두 존재하는 코퍼스
const K_RETRIEVE = 200; // arm별 랭킹 상한
const ARMS = ['bm25-han', 'bm25-ko', 'dict-han', 'vec-han', 'vec-ko', 'hybrid'];
const USE_RERANKER = process.argv.includes('--reranker');

const dbPath = resolve('data/history.sqlite');

/** 사람이 읽는 진행 로그 */
function log(...a) {
  console.log(...a);
}

/** e5 임베더 로드(mean pooling + normalize → cosine=dot) */
async function loadEmbedder() {
  log(`[model] ${MODEL} 로딩…`);
  const ex = await pipeline('feature-extraction', MODEL);
  return async (texts) => {
    const out = await ex(texts, { pooling: 'mean', normalize: true });
    return out.tolist();
  };
}

/** 배치 임베딩(진행 로그) */
async function embedAll(embed, texts, prefix, label) {
  const vecs = new Array(texts.length);
  const B = 64;
  for (let i = 0; i < texts.length; i += B) {
    const batch = texts.slice(i, i + B).map((t) => prefix + t);
    const res = await embed(batch);
    for (let j = 0; j < res.length; j++) vecs[i + j] = Float32Array.from(res[j]);
    if (i % (B * 8) === 0)
      log(`  [embed:${label}] ${Math.min(i + B, texts.length)}/${texts.length}`);
  }
  return vecs;
}

/** 바이너리 임베딩 캐시(재현·재실행 가속). universe 시그니처 불일치 시 무효 */
function cachePaths(kind) {
  return {
    bin: resolve('tmp', `embed-e5small-${kind}.f32`),
    meta: resolve('tmp', `embed-e5small-${kind}.meta.json`),
  };
}
function loadCache(kind, ids) {
  const { bin, meta } = cachePaths(kind);
  if (!existsSync(bin) || !existsSync(meta)) return null;
  const m = JSON.parse(readFileSync(meta, 'utf8'));
  if (
    m.model !== MODEL ||
    m.dim !== DIM ||
    m.count !== ids.length ||
    m.first !== ids[0] ||
    m.last !== ids[ids.length - 1]
  )
    return null;
  const buf = readFileSync(bin);
  const flat = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
  const map = new Map();
  for (let i = 0; i < ids.length; i++) map.set(ids[i], flat.subarray(i * DIM, i * DIM + DIM));
  return map;
}
function saveCache(kind, ids, map) {
  const { bin, meta } = cachePaths(kind);
  const flat = new Float32Array(ids.length * DIM);
  for (let i = 0; i < ids.length; i++) flat.set(map.get(ids[i]), i * DIM);
  writeFileSync(bin, Buffer.from(flat.buffer));
  writeFileSync(
    meta,
    JSON.stringify({
      model: MODEL,
      dim: DIM,
      count: ids.length,
      first: ids[0],
      last: ids[ids.length - 1],
    }),
  );
}

/** 벡터 arm: 질의벡터 vs 전 passage(정규화됨) cosine top-K passageId */
function vectorRank(qVec, ids, vecMap, k) {
  const scored = ids.map((id) => ({ id, s: cosineSim(qVec, vecMap.get(id)) }));
  scored.sort((a, b) => (b.s !== a.s ? b.s - a.s : a.id - b.id));
  return scored.slice(0, k).map((x) => x.id);
}

/** 오프라인 크로스인코더 리랭커 로드(bge-reranker, transformers.js). 외부 전송 없음·결정론 */
async function loadReranker() {
  log(`[reranker] ${RERANK_MODEL} 로딩…`);
  const tok = await AutoTokenizer.from_pretrained(RERANK_MODEL);
  const mdl = await AutoModelForSequenceClassification.from_pretrained(RERANK_MODEL);
  // (query, doc) 쌍을 재채점 → 관련도 logit(높을수록 관련). 후보 id를 점수 내림차순으로 반환.
  return async (query, candidates /* [{id,text}] */) => {
    const inputs = tok(Array(candidates.length).fill(query), {
      text_pair: candidates.map((c) => c.text),
      padding: true,
      truncation: true,
    });
    const { logits } = await mdl(inputs);
    const scores = logits.tolist().map((r) => r[0]);
    return candidates
      .map((c, i) => ({ id: c.id, s: scores[i] }))
      .sort((a, b) => (b.s !== a.s ? b.s - a.s : a.id - b.id))
      .map((x) => x.id);
  };
}

async function main() {
  mkdirSync('tmp', { recursive: true });
  const db = await openBundledDb(); // data/history.sqlite 보장
  const raw = createClient({ url: 'file:' + dbPath });

  // --- universe: sg/sy passage(원문+직역) ---
  log('[data] sg/sy passage 로드…');
  const prows = (
    await raw.execute(`
      SELECT p.id, p.text_han AS han, t.text AS ko
        FROM passage p
        JOIN node n ON n.id = p.node_id
        JOIN corpus c ON c.id = n.corpus_id
        JOIN translation t ON t.passage_id = p.id AND t.adopted = 1
       WHERE c.code IN ('sg','sy')
       ORDER BY p.id`)
  ).rows;
  const ids = prows.map((r) => Number(r.id));
  const idSet = new Set(ids);
  const hanText = new Map(prows.map((r) => [Number(r.id), String(r.han)]));
  const koText = new Map(prows.map((r) => [Number(r.id), String(r.ko)]));
  log(`[data] passage=${ids.length}`);

  // --- 임베딩(캐시 우선) ---
  let embed = null;
  async function getEmbedder() {
    if (!embed) embed = await loadEmbedder();
    return embed;
  }
  async function buildVecs(kind, textMap, prefix) {
    const cached = loadCache(kind, ids);
    if (cached) {
      log(`[embed:${kind}] 캐시 적중(${ids.length})`);
      return cached;
    }
    const e = await getEmbedder();
    const arr = await embedAll(
      e,
      ids.map((id) => textMap.get(id)),
      prefix,
      kind,
    );
    const map = new Map(ids.map((id, i) => [id, arr[i]]));
    saveCache(kind, ids, map);
    return map;
  }
  const vecHan = await buildVecs('han', hanText, 'passage: ');
  const vecKo = await buildVecs('ko', koText, 'passage: ');

  // --- 사전(정자↔간자 역맵, 독음→surface) via raw SQL ---
  async function simplifiedToTraditional(q) {
    const chars = [...new Set([...q])];
    const rows = (
      await raw.execute({
        sql: `SELECT char, simplified FROM char_simplified WHERE simplified IN (${chars.map(() => '?').join(',')})`,
        args: chars,
      })
    ).rows;
    const rev = new Map();
    for (const r of rows)
      if (!rev.has(String(r.simplified))) rev.set(String(r.simplified), String(r.char));
    return [...q].map((ch) => rev.get(ch) ?? ch).join('');
  }
  async function readingToSurfaces(q) {
    const rows = (
      await raw.execute({
        sql: `SELECT DISTINCT e.surface FROM entity_reading er JOIN entity e ON e.id = er.entity_id
               WHERE er.reading = ? AND er.adopted = 1`,
        args: [q],
      })
    ).rows;
    return rows.map((r) => String(r.surface));
  }

  // --- BM25 arm(sg/sy universe로 필터) ---
  async function bm25Han(q) {
    const hits = await db.searchHan(q, { limit: K_RETRIEVE * 3 });
    return hits
      .map((h) => h.passageId)
      .filter((id) => idSet.has(id))
      .slice(0, K_RETRIEVE);
  }
  async function bm25Ko(q) {
    const hits = await db.searchKo(q, { limit: K_RETRIEVE * 3 });
    return hits
      .map((h) => h.passageId)
      .filter((id) => idSet.has(id))
      .slice(0, K_RETRIEVE);
  }
  async function dictHan(q, lang) {
    if (lang === 'simplified') return bm25Han(await simplifiedToTraditional(q));
    if (lang && lang.startsWith('ko')) {
      const surfaces = await readingToSurfaces(q);
      if (surfaces.length === 0) return [];
      // 이표기별 검색 후 RRF 병합
      const lists = [];
      for (const s of surfaces) lists.push(await bm25Han(s));
      return rrf(lists)
        .map((f) => f.item)
        .slice(0, K_RETRIEVE);
    }
    return bm25Han(q);
  }

  // --- Q-A: char-pair cosine ---
  log('[Q-A] char-pair cosine…');
  const cp = JSON.parse(readFileSync('eval/char-pairs.json', 'utf8'));
  const e = await getEmbedder();
  const cpByCat = {};
  for (const p of cp.pairs) {
    const [va, vb] = await e(['query: ' + p.a, 'query: ' + p.b]);
    const cos = cosineSim(Float32Array.from(va), Float32Array.from(vb));
    (cpByCat[p.category] ??= []).push({ a: p.a, b: p.b, cos: Number(cos.toFixed(4)) });
  }
  const charPairs = {};
  for (const [cat, arr] of Object.entries(cpByCat)) {
    const vals = arr.map((x) => x.cos);
    charPairs[cat] = {
      mean: Number(mean(vals).toFixed(4)),
      min: Math.min(...vals),
      max: Math.max(...vals),
      pairs: arr,
    };
  }

  // --- Q-B~E: arm별 랭킹·지표 ---
  log('[Q-B~E] arm별 검색 평가…');
  const rel = JSON.parse(readFileSync('eval/relevance.json', 'utf8'));
  const reranker = USE_RERANKER ? await loadReranker() : null;
  const perQuery = [];
  for (const topic of rel.topics) {
    const positives = new Set(topic.positives);
    for (const { q, lang } of topic.queries) {
      const qVec = Float32Array.from((await e(['query: ' + q]))[0]);
      const ranks = {
        'bm25-han': await bm25Han(q),
        'bm25-ko': await bm25Ko(q),
        'dict-han': await dictHan(q, lang),
        'vec-han': vectorRank(qVec, ids, vecHan, K_RETRIEVE),
        'vec-ko': vectorRank(qVec, ids, vecKo, K_RETRIEVE),
      };
      ranks['hybrid'] = rrf([
        ranks['dict-han'],
        ranks['bm25-ko'],
        ranks['vec-han'],
        ranks['vec-ko'],
      ])
        .map((f) => f.item)
        .slice(0, K_RETRIEVE);
      if (reranker) {
        // 하이브리드 상위 후보를 재채점 — 원문(한자)/직역(한국어) 두 변형 비교
        const top = ranks['hybrid'].slice(0, RERANK_TOPN);
        ranks['rr-han'] = await reranker(
          q,
          top.map((id) => ({ id, text: hanText.get(id) })),
        );
        ranks['rr-ko'] = await reranker(
          q,
          top.map((id) => ({ id, text: koText.get(id) })),
        );
      }
      const row = { topic: topic.id, q, lang, positiveCount: positives.size, arms: {} };
      for (const [arm, ranked] of Object.entries(ranks)) {
        row.arms[arm] = {
          'recall@5': Number(recallAtK(ranked, positives, 5).toFixed(4)),
          'recall@10': Number(recallAtK(ranked, positives, 10).toFixed(4)),
          rr: Number(reciprocalRank(ranked, positives).toFixed(4)),
          'ndcg@10': Number(ndcgAtK(ranked, positives, 10).toFixed(4)),
        };
      }
      perQuery.push(row);
    }
  }

  // --- 집계(전체 + lang별) ---
  const armSet = USE_RERANKER ? [...ARMS, 'rr-han', 'rr-ko'] : ARMS;
  function aggregate(rows) {
    const agg = {};
    for (const arm of armSet) {
      const present = rows.filter((r) => r.arms[arm]);
      if (present.length === 0) continue;
      agg[arm] = {
        'recall@5': Number(mean(present.map((r) => r.arms[arm]['recall@5'])).toFixed(4)),
        'recall@10': Number(mean(present.map((r) => r.arms[arm]['recall@10'])).toFixed(4)),
        mrr: Number(mean(present.map((r) => r.arms[arm].rr)).toFixed(4)),
        'ndcg@10': Number(mean(present.map((r) => r.arms[arm]['ndcg@10'])).toFixed(4)),
      };
    }
    return agg;
  }
  const overall = aggregate(perQuery);
  const langs = [...new Set(perQuery.map((r) => r.lang))].sort();
  const byLang = {};
  for (const lang of langs) byLang[lang] = aggregate(perQuery.filter((r) => r.lang === lang));

  const result = {
    meta: {
      model: MODEL,
      dim: DIM,
      universe: UNIVERSE.join('+'),
      passages: ids.length,
      arms: armSet,
      reranker: USE_RERANKER,
      note: 'krh-cvh Phase 0 — 리랭커 제외 결정론. 정답셋·char-pair는 DRAFT(승현님 검수 대상).',
    },
    charPairs,
    retrieval: { overall, byLang, perQuery },
  };
  writeFileSync('tmp/embedding-eval.json', JSON.stringify(result, null, 1));

  // --- 콘솔 요약 ---
  log('\n===== char-pair cosine (Q-A) =====');
  for (const [cat, v] of Object.entries(charPairs))
    log(`  ${cat.padEnd(30)} mean=${v.mean} [${v.min}~${v.max}]`);
  log('\n===== 검색 arm 전체 평균 (Q-B) =====');
  log('  arm'.padEnd(20), 'R@5    R@10   MRR    nDCG@10');
  for (const arm of armSet) {
    const a = overall[arm];
    if (a)
      log(`  ${arm.padEnd(18)} ${a['recall@5']}  ${a['recall@10']}  ${a.mrr}  ${a['ndcg@10']}`);
  }
  log('\n===== 질의 언어별 MRR (Q-D·Q-E) =====');
  log('  lang'.padEnd(16), armSet.join('  '));
  for (const lang of langs)
    log(`  ${lang.padEnd(14)}`, armSet.map((arm) => byLang[lang][arm]?.mrr ?? '-').join('   '));
  log('\n→ tmp/embedding-eval.json 기록 완료');

  db.close();
  raw.close();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
