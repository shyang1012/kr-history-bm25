/**
 * @Project: kr-history-bm25
 * @File: version.test.ts
 * @Description: readPackageVersion가 package.json version과 일치하는지 검증(버전 드리프트 회귀 방지).
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { readPackageVersion } from '../src/version';

const pkgPath = fileURLToPath(new URL('../package.json', import.meta.url));
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) as { version: string };

describe('readPackageVersion', () => {
  it('package.json version과 일치한다(하드코딩 드리프트 차단)', () => {
    expect(readPackageVersion()).toBe(pkg.version);
  });

  it('semver 형식이다', () => {
    expect(readPackageVersion()).toMatch(/^\d+\.\d+\.\d+/);
  });
});
