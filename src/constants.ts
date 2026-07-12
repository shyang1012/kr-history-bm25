/**
 * @Project: kr-history-bm25
 * @File: constants.ts
 * @Description: 패키지 식별자 단일 소스. package.json name/bin과 정합하는 상수를 CLI·MCP·버전 로더가 공유한다.
 *               문자열 하드코딩 중복(drift) 방지 — 패키지명/서버명 변경 시 이 파일만 고친다. 내부 상수(공개 배럴 미노출).
 * @Author: shyang
 * @LastModified: 2026-07-12
 */

/** npm 패키지 식별자(package.json name과 일치). 버전 walk-up·npx -p 대상. */
export const PACKAGE_NAME = 'kr-history-bm25';

/** MCP 서버 실행 bin 이름(package.json bin과 일치). */
export const MCP_BIN = 'krh-mcp';

/** MCP 서버가 initialize에서 보고하는 serverInfo.name. */
export const MCP_SERVER_NAME = 'kr-history-bm25';
