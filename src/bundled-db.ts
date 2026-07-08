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
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { tmpdir } from 'node:os';
import { HistoryDb } from './history-db';

/** 동봉 gzip 코퍼스 파일명 */
const GZ_NAME = 'history.sqlite.gz';

/** 압축 해제 대상 파일명 */
const DB_NAME = 'history.sqlite';

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

/**
 * 동봉된 사전 구축 코퍼스를 연다(필요 시 1회 압축 해제).
 * @returns 검색 준비된 HistoryDb 인스턴스
 */
export async function openBundledDb(): Promise<HistoryDb> {
  const dataDir = findDataDir();
  const gzPath = join(dataDir, GZ_NAME);
  let dbPath = join(dataDir, DB_NAME);

  if (!existsSync(dbPath)) {
    const decompressed = gunzipSync(readFileSync(gzPath));
    try {
      writeFileSync(dbPath, decompressed);
    } catch {
      // data/ 쓰기 불가(읽기전용 설치 등) → OS 임시 폴더로 폴백
      const fallbackDir = join(tmpdir(), 'kr-history-bm25');
      mkdirSync(fallbackDir, { recursive: true });
      dbPath = join(fallbackDir, DB_NAME);
      if (!existsSync(dbPath)) {
        writeFileSync(dbPath, decompressed);
      }
    }
  }

  return HistoryDb.open(dbPath);
}
