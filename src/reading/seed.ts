/**
 * @Project: kr-history-bm25
 * @File: seed.ts
 * @Description: 학술시드 로더 — data/reading-seeds.json을 읽어 원음 확정 시드를 제공한다.
 *               char 시드(글자 본음, 모든 개체에 전파)와 surface 시드(개체 전체 원음, 최우선)를 분리한다.
 *               etymon-khan 방식의 PM 점증 관리 권위 데이터.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import { readFileSync } from 'node:fs';

/** 시드 1건 */
export interface SeedEntry {
  original: string;
  note?: string;
}

/** 시드 묶음 */
export interface Seeds {
  /** 글자 본음 시드 — char_reading을 덮어 모든 개체에 전파 */
  charSeeds: Map<string, SeedEntry>;
  /** 개체 전체 원음 시드 — 합성보다 우선 */
  surfaceSeeds: Map<string, SeedEntry>;
}

interface SeedFile {
  char?: Record<string, SeedEntry>;
  surface?: Record<string, SeedEntry>;
}

/**
 * reading-seeds.json을 로드한다.
 * @param path - 시드 JSON 경로
 * @returns char/surface 시드 Map
 */
export function loadSeeds(path: string): Seeds {
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as SeedFile;
  return {
    charSeeds: new Map(Object.entries(parsed.char ?? {})),
    surfaceSeeds: new Map(Object.entries(parsed.surface ?? {})),
  };
}
