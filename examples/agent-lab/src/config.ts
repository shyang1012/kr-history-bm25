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

/** run.ts가 소비하는 부팅 설정 — ollama 백엔드 + orchestrator caps + krh MCP 서버 스펙. */
export const AGENT_CONFIG = {
  ollama: {
    baseUrl: 'http://localhost:11434',
    model: 'gemma4:e2b',
  },
  caps: { maxLoops: 6 } satisfies OrchestratorCaps,
  krh: selectKrhSpec(process.env.AGENT_LAB_MCP),
};
