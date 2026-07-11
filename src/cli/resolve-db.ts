/**
 * @Project: kr-history-bm25
 * @File: resolve-db.ts
 * @Description: 조회 명령(search/cluster/place)의 DB 소스 결정 로직. --db·KRH_DB 미지정 시
 *               동봉 코퍼스를 기본으로 삼아 "설치하자마자 검색"을 보장한다(krh-qrb). 순수 함수.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */

/** 조회 명령이 열 DB 소스. bundled=동봉 코퍼스, path=사용자 지정 경로 */
export type QueryDbSource = { kind: 'bundled' } | { kind: 'path'; path: string };

/**
 * 조회 명령의 DB 소스를 결정한다. 우선순위: --db 옵션 > KRH_DB 환경변수 > 동봉 코퍼스.
 * 빈 문자열은 미지정으로 간주한다.
 * @param dbOpt - `--db` 옵션 값(미지정 시 undefined)
 * @param envDb - `KRH_DB` 환경변수 값(미설정 시 undefined)
 * @returns 열어야 할 DB 소스
 */
export function resolveQueryDbSource(dbOpt?: string, envDb?: string): QueryDbSource {
  const path = (dbOpt && dbOpt.trim()) || (envDb && envDb.trim());
  return path ? { kind: 'path', path } : { kind: 'bundled' };
}
