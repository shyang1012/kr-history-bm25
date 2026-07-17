/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/config.ts
 * @Description: 신규⑥ AGENT_CONFIG(도메인 배선) — ollama·caps·krh(MCP dual-profile) 부팅 설정.
 *   run.ts가 AGENT_CONFIG.krh/.ollama/.caps로 조립한다. #1 2프로파일: krhDev(로컬 빌드
 *   `node dist/mcp/server.js`) / krhProduct(배포판 `npx -y -p kr-history-bm25 krh-mcp`).
 *   선택은 테스트 가능한 selectKrhSpec(mode)로 분리한다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { McpServerSpec } from './mcp-bridge';
import type { OrchestratorCaps } from './orchestrator/types';

// config.ts = examples/agent-lab/src/config.ts → 상위 3레벨(src → agent-lab → examples)이 repo 루트.
const SRC_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SRC_DIR, '../../..');

/** dev 프로파일 — 로컬 빌드 산출물(`dist/mcp/server.js`)을 node로 직접 구동. */
const krhDev: McpServerSpec = {
  id: 'krh',
  command: 'node',
  args: [path.join(REPO_ROOT, 'dist', 'mcp', 'server.js')],
  env: {},
};

/** product 프로파일 — 배포판 npx 드롭인(채팅 드롭인 관찰용). */
const krhProduct: McpServerSpec = {
  id: 'krh',
  command: 'cmd',
  args: ['/d', '/s', '/c', 'npx', '-y', '-p', 'kr-history-bm25', 'krh-mcp'],
  env: {},
};

/**
 * AGENT_LAB_MCP 환경변수 값으로 krh MCP 서버 스펙을 선택한다. 'product'만 배포판, 그 외(미지정 포함)는
 * 로컬 빌드(dev).
 *
 * @param mode process.env.AGENT_LAB_MCP 값
 * @returns 선택된 McpServerSpec
 */
export function selectKrhSpec(mode: string | undefined): McpServerSpec {
  return mode === 'product' ? krhProduct : krhDev;
}

/**
 * AGENT_LAB_THINK 환경변수를 think 설정으로 파싱한다. 'true'/'false'만 각 boolean으로,
 * 미지정·기타 값은 undefined(= OpenAI 호환 primary 경로). thinking 모델(gemma4:e2b 계열)은
 * 'false'로 네이티브 fallback을, 함수호출 특화 instruct 모델(kanana 등)은 미지정으로 OpenAI 호환을 쓴다.
 *
 * @param raw process.env.AGENT_LAB_THINK 값
 * @returns true | false | undefined
 */
export function parseThink(raw: string | undefined): boolean | undefined {
  if (raw === 'true') {
    return true;
  }
  if (raw === 'false') {
    return false;
  }
  return undefined;
}

/**
 * run.ts가 소비하는 부팅 설정 — ollama 백엔드 + orchestrator caps + krh MCP 서버 스펙.
 * 모델 비교 실험(gemma4:e2b/e4b·kanana 등)을 위해 model·think·baseUrl을 환경변수로 오버라이드한다:
 *   AGENT_LAB_MODEL(기본 gemma4:e2b) · AGENT_LAB_THINK('true'|'false', 미지정=OpenAI 호환) ·
 *   AGENT_LAB_OLLAMA_URL(기본 localhost:11434).
 */
export const AGENT_CONFIG = {
  ollama: {
    baseUrl: process.env.AGENT_LAB_OLLAMA_URL ?? 'http://localhost:11434',
    model: process.env.AGENT_LAB_MODEL ?? 'gemma4:e2b',
    think: parseThink(process.env.AGENT_LAB_THINK),
  },
  // maxToolRetries=10(도구 실패 시 인자 고쳐 재시도) + 그 재시도를 담을 loop 여유(maxLoops 12).
  caps: { maxLoops: 12, maxToolRetries: 10 } satisfies OrchestratorCaps,
  krh: selectKrhSpec(process.env.AGENT_LAB_MCP),
};
