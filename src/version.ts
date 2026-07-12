/**
 * @Project: kr-history-bm25
 * @File: version.ts
 * @Description: 패키지 버전 단일 소스. package.json에서 동적으로 읽어 CLI·MCP가 공유한다.
 *               버전 문자열 하드코딩 금지 — 배포 시 package.json만 bump하면 전 표면이 정합한다.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync } from 'node:fs';

/** 자기 패키지 식별자(walk-up 중 중첩 dependency의 package.json 오탐 방지) */
const PACKAGE_NAME = 'kr-history-bm25';

/** 1회 read 후 캐시 */
let cached: string | undefined;

/**
 * 자기 package.json의 version을 읽는다.
 * 모듈 위치에서 상위로 올라가며 `name === 'kr-history-bm25'`인 package.json을 찾는다
 * (`bundled-db.ts`의 findDataDir 패턴 답습 — dist/cli·dist/mcp·dist·src 진입점 차이 흡수).
 * @returns semver 버전 문자열(예: '0.4.0')
 */
export function readPackageVersion(): string {
  if (cached !== undefined) {
    return cached;
  }
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, 'package.json');
    if (existsSync(candidate)) {
      const pkg = JSON.parse(readFileSync(candidate, 'utf8')) as {
        name?: string;
        version?: string;
      };
      if (pkg.name === PACKAGE_NAME && typeof pkg.version === 'string') {
        cached = pkg.version;
        return cached;
      }
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(`package.json(name=${PACKAGE_NAME})을 찾을 수 없어 버전을 확인할 수 없습니다.`);
}
