/**
 * @Project: kr-history-bm25
 * @File: resolve-db.test.ts
 * @Description: 조회 명령의 DB 소스 결정 로직(resolveQueryDbSource) 우선순위 검증.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { describe, it, expect } from 'vitest';
import { resolveQueryDbSource } from '../../src/cli/resolve-db';

describe('resolveQueryDbSource — 조회 명령 DB 소스 우선순위', () => {
  it('--db 명시 시 그 경로를 쓴다(최우선)', () => {
    expect(resolveQueryDbSource('mine.sqlite', undefined)).toEqual({
      kind: 'path',
      path: 'mine.sqlite',
    });
  });

  it('--db 미지정이고 KRH_DB 설정 시 env 경로를 쓴다', () => {
    expect(resolveQueryDbSource(undefined, '/env/db.sqlite')).toEqual({
      kind: 'path',
      path: '/env/db.sqlite',
    });
  });

  it('--db가 KRH_DB보다 우선한다', () => {
    expect(resolveQueryDbSource('cli.sqlite', '/env/db.sqlite')).toEqual({
      kind: 'path',
      path: 'cli.sqlite',
    });
  });

  it('둘 다 없으면 동봉 코퍼스를 기본으로 한다', () => {
    expect(resolveQueryDbSource(undefined, undefined)).toEqual({ kind: 'bundled' });
  });

  it('빈 문자열은 미지정으로 간주해 동봉 코퍼스로 폴백한다', () => {
    expect(resolveQueryDbSource('', '')).toEqual({ kind: 'bundled' });
  });
});
