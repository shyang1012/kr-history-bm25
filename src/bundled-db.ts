/**
 * @Project: kr-history-bm25
 * @File: bundled-db.ts
 * @Description: 패키지에 동봉된 사전 구축 코퍼스(data/history.sqlite.gz)를 첫 사용 시 data/로 압축 해제해 연다.
 *               소비자는 XML·ingest 없이 즉시 검색할 수 있다. data/ 쓰기 불가 시 OS 임시 폴더로 폴백한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { HistoryDb } from './history-db';

/** 동봉 gzip 코퍼스 파일명 */
const GZ_NAME = 'history.sqlite.gz';

/** 압축 해제 대상 파일명 */
const DB_NAME = 'history.sqlite';

/**
 * 동봉 DB 콘텐츠 버전. 스키마·데이터(예: 의미 벡터)가 바뀌면 갱신한다. 추출본 버전이 이와 다르면 재추출한다(F-02 —
 * 업그레이드 사용자가 구 추출본을 재사용해 벡터를 못 받는 문제 방지).
 */
const BUNDLE_VERSION = '0.4.0-embed';

/** 추출본 버전 마커 경로 */
function versionPath(dbPath: string): string {
  return dbPath + '.version';
}

/** 추출본의 기록된 버전(마커 없으면 null) */
function extractedVersion(dbPath: string): string | null {
  const vp = versionPath(dbPath);
  return existsSync(vp) ? readFileSync(vp, 'utf8').trim() : null;
}

/** temp 파일 고유화 카운터(동일 프로세스 내 다중 호출 대비) */
let tmpCounter = 0;

/**
 * 압축 해제본을 원자적으로 쓴다 — 고유 temp에 쓴 뒤 rename(동시 추출 경합 시 부분쓰기·손상 방지, POSIX 원자적).
 * 완료 마커는 DB 파일이 온전해진 뒤(rename 후) 마지막에 기록한다.
 * @param dbPath - 추출 대상 경로
 * @param data - 압축 해제된 DB 바이트
 */
function atomicExtract(dbPath: string, data: Buffer): void {
  const tmp = `${dbPath}.tmp-${process.pid}-${(tmpCounter += 1)}`;
  writeFileSync(tmp, data);
  renameSync(tmp, dbPath);
  writeFileSync(versionPath(dbPath), BUNDLE_VERSION);
}

/**
 * 모듈 위치에서 상위로 올라가며 data/history.sqlite.gz를 보유한 data 디렉터리를 찾는다.
 * dist/index.js·dist/cli/krh.js·src(테스트) 등 진입점 차이를 흡수한다.
 * @returns data 디렉터리 절대 경로
 */
export function findDataDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i += 1) {
    const candidate = join(dir, 'data', GZ_NAME);
    if (existsSync(candidate)) {
      return join(dir, 'data');
    }
    const parent = dirname(dir);
    if (parent === dir) {
      break;
    }
    dir = parent;
  }
  throw new Error(
    '동봉 코퍼스(data/history.sqlite.gz)를 찾을 수 없습니다. npm run build:corpus로 생성하세요.',
  );
}

/** openBundledDb 옵션 */
export interface OpenBundledOptions {
  /** 압축 해제 대상 디렉터리(기본: 동봉 data/). 테스트·읽기전용 환경 격리용 */
  targetDir?: string;
}

/**
 * 동봉된 사전 구축 코퍼스를 연다(필요 시 1회 압축 해제).
 * @param options - 대상 디렉터리 옵션
 * @returns 검색 준비된 HistoryDb 인스턴스
 */
export async function openBundledDb(options: OpenBundledOptions = {}): Promise<HistoryDb> {
  const dataDir = findDataDir();
  const gzPath = join(dataDir, GZ_NAME);
  const targetDir = options.targetDir ?? dataDir;
  let dbPath = join(targetDir, DB_NAME);

  // 없거나 버전이 다르면(구 추출본) 재추출 — 벡터 등 새 콘텐츠 반영(F-02)
  if (!existsSync(dbPath) || extractedVersion(dbPath) !== BUNDLE_VERSION) {
    mkdirSync(targetDir, { recursive: true });
    const decompressed = gunzipSync(readFileSync(gzPath));
    try {
      atomicExtract(dbPath, decompressed);
    } catch {
      // data/ 쓰기 불가(읽기전용 설치 등) → OS 임시 폴더로 폴백
      const fallbackDir = join(tmpdir(), 'kr-history-bm25');
      mkdirSync(fallbackDir, { recursive: true });
      dbPath = join(fallbackDir, DB_NAME);
      if (!existsSync(dbPath) || extractedVersion(dbPath) !== BUNDLE_VERSION) {
        atomicExtract(dbPath, decompressed);
      }
    }
  }

  return HistoryDb.open(dbPath);
}
