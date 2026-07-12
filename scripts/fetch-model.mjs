/**
 * @Project: kr-history-bm25
 * @File: fetch-model.mjs
 * @Description: 동봉 임베딩 모델(e5-small 양자화 ONNX + 토크나이저)을 models/ 로 내려받는다. git 제외(118MB)이므로
 *               빌드·배포·재현 환경에서 실행해 models/ 를 구성한다. 이미 있으면 스킵. transformers.js 로컬 로드용.
 *               실행: node scripts/fetch-model.mjs
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { mkdirSync, existsSync, createWriteStream } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const REPO = 'Xenova/multilingual-e5-small';
const BASE = `https://huggingface.co/${REPO}/resolve/main`;
const DEST = resolve('models', ...REPO.split('/'));

// transformers.js 로컬 로드가 요구하는 최소 파일셋(F-03 계약)
const FILES = [
  'config.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'onnx/model_quantized.onnx',
];

async function fetchFile(rel) {
  const out = join(DEST, rel);
  if (existsSync(out)) {
    console.log(`  skip (존재)  ${rel}`);
    return;
  }
  mkdirSync(dirname(out), { recursive: true });
  const res = await fetch(`${BASE}/${rel}`);
  if (!res.ok || !res.body) {
    throw new Error(`다운로드 실패 ${rel}: HTTP ${res.status}`);
  }
  await pipeline(Readable.fromWeb(res.body), createWriteStream(out));
  console.log(`  받음        ${rel}`);
}

async function main() {
  console.log(`[fetch-model] ${REPO} → models/`);
  for (const f of FILES) {
    await fetchFile(f);
  }
  console.log('[fetch-model] 완료');
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
