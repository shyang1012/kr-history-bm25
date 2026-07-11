/**
 * @Project: kr-history-bm25
 * @File: history-db.ts
 * @Description: 공개 파사드. SQLite 코퍼스를 열어 검색·조회·군집·이표기·ingest·직역을 단일 객체로 제공한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { createDbConnection, type DbConnection } from './db/client';
import { runMigrations } from './db/migrate';
import { ingestCorpus, type IngestOptions, type IngestStats } from './ingest/ingest-corpus';
import {
  translateCorpus,
  type TranslateOptions,
  type TranslateStats,
} from './translate/translate-corpus';
import {
  exportPending,
  importResults,
  type ExportPendingOptions,
  type ExportPendingResult,
  type ImportResultsOptions,
  type ImportResultsStats,
} from './translate/batch';
import { ingestUnihan, type IngestUnihanResult } from './reading/ingest-unihan';
import {
  ingestSimplified,
  loadTraditionalForChars,
  expandSimplifiedToTraditional,
  type IngestSimplifiedResult,
  type QueryExpansion,
} from './reading/simplified';
import { loadCharMap } from './reading/reading-store';
import { buildDictIndex } from './reading/dict-source';
import { loadSeeds, type Seeds } from './reading/seed';
import { buildReadings, type BuildStats } from './reading/build-readings';
import {
  exportPendingReadingChars,
  importReadingChars,
  type ReadingExport,
  type ReadingResult,
  type ImportStats,
} from './reading/batch';
import { searchHan, type SearchHanOptions } from './search/search-han';
import { searchKo, type SearchKoOptions } from './search/search-ko';
import { lookupPlace, type LookupOptions } from './search/lookup-place';
import { cluster, type ClusterOptions } from './search/cluster';
import { withVariants, addVariantGroup, type VariantMemberSpec } from './search/variants';
import { searchByReading, type ReadingSearchResult } from './search/search-by-reading';
import { placeClusters, type PlaceClusterOptions } from './search/place-clusters';
import {
  suggestPlaceClusterParams,
  type SuggestOptions,
  type SuggestedParams,
} from './search/suggest-params';
import type {
  SearchHit,
  KoSearchHit,
  PlaceOccurrence,
  ClusterNeighbor,
  VariantSearchResult,
  PlaceClusterResult,
} from './types';

/** 한국사 BM25 코퍼스 핸들 */
export class HistoryDb {
  private readonly conn: DbConnection;

  constructor(conn: DbConnection) {
    this.conn = conn;
  }

  /**
   * 코퍼스를 열고(필요 시 마이그레이션) 핸들을 만든다.
   * @param path - SQLite 파일 경로 또는 ':memory:'
   * @returns HistoryDb 인스턴스
   */
  static async open(path: string): Promise<HistoryDb> {
    const conn = createDbConnection(path);
    await runMigrations(conn.client);
    return new HistoryDb(conn);
  }

  /** 사서 디렉터리를 ingest한다(주 코퍼스 + 구조화 색인) */
  ingest(options: IngestOptions): Promise<IngestStats> {
    return ingestCorpus(this.conn, options);
  }

  /** 미완 본문을 증분 직역한다(보조 코퍼스) */
  translate(options: TranslateOptions): Promise<TranslateStats> {
    return translateCorpus(this.conn, options);
  }

  /** 구독 모델 직역용 대기 본문을 내보낸다(배치 흐름) */
  exportPending(options: ExportPendingOptions): Promise<ExportPendingResult> {
    return exportPending(this.conn, options);
  }

  /** 구독 모델이 직역한 결과를 적재한다(배치 흐름) */
  importResults(options: ImportResultsOptions): Promise<ImportResultsStats> {
    return importResults(this.conn, options);
  }

  /** 한자 원문 BM25 검색 */
  searchHan(term: string, options?: SearchHanOptions): Promise<SearchHit[]> {
    return searchHan(this.conn.client, term, options);
  }

  /** 직역(보조) BM25 검색 */
  searchKo(term: string, options?: SearchKoOptions): Promise<KoSearchHit[]> {
    return searchKo(this.conn.client, term, options);
  }

  /** reading-aware 검색 — 한글 독음으로 한자 표기를 찾아 원문 병합 검색(대표음·관용 병기) */
  searchByReading(query: string, options?: SearchHanOptions): Promise<ReadingSearchResult> {
    return searchByReading(this.conn.client, query, options);
  }

  /** 간자체 질의를 정자 후보로 확장한다(투명성 표시용). searchHan은 내부적으로 이를 자동 적용한다 */
  async traditionalize(term: string): Promise<QueryExpansion> {
    const revMap = await loadTraditionalForChars(this.conn.client, [...term]);
    return expandSimplifiedToTraditional(term, revMap);
  }

  /** seed 유도 국소 퍼지 지명 군집(FDBSCAN) — 공기 기반 소속도(전역 밀도 아님) */
  placeClusters(seed: string, options?: PlaceClusterOptions): Promise<PlaceClusterResult> {
    return placeClusters(this.conn.client, seed, options);
  }

  /** seed별 FDBSCAN 파라미터를 분포 기반으로 추천한다(추천만, 군집 안 함). 없는 seed는 null */
  suggestPlaceClusterParams(
    seed: string,
    options?: SuggestOptions,
  ): Promise<SuggestedParams | null> {
    return suggestPlaceClusterParams(this.conn.client, seed, options);
  }

  /** 구조화 색인 조회(표기 출현 위치) */
  lookupPlace(surface: string, options?: LookupOptions): Promise<PlaceOccurrence[]> {
    return lookupPlace(this.conn.client, surface, options);
  }

  /** 지명 군집(co-occurrence) */
  cluster(surface: string, options?: ClusterOptions): Promise<ClusterNeighbor[]> {
    return cluster(this.conn.client, surface, options);
  }

  /** 이표기 확장 검색 */
  withVariants(surface: string, options?: SearchHanOptions): Promise<VariantSearchResult> {
    return withVariants(this.conn.client, surface, options);
  }

  /** 이표기 그룹 등록(수동 시드) */
  addVariantGroup(members: VariantMemberSpec[], note?: string, source?: string): Promise<number> {
    return addVariantGroup(this.conn.client, members, note, source);
  }

  /** Unihan_Readings.txt(kHangul)를 char_reading에 적재한다(독음 사전 재료) */
  ingestUnihan(readingsPath: string): Promise<IngestUnihanResult> {
    return ingestUnihan(this.conn, { readingsPath });
  }

  /** Unihan_Variants.txt(kSimplifiedVariant)를 char_simplified에 적재한다(간자체 병기 재료) */
  ingestSimplified(variantsPath: string): Promise<IngestSimplifiedResult> {
    return ingestSimplified(this.conn, { variantsPath });
  }

  /** 독음 사전을 구축한다(원음 확정 → 관용 도출). 시드·표준국어대사전 소스를 결합한다 */
  async buildReadings(opts?: { seedsPath?: string; dictPaths?: string[] }): Promise<BuildStats> {
    const charMap = await loadCharMap(this.conn.client);
    const dict = opts?.dictPaths?.length
      ? buildDictIndex(opts.dictPaths)
      : new Map<string, string>();
    const seeds: Seeds = opts?.seedsPath
      ? loadSeeds(opts.seedsPath)
      : { charSeeds: new Map(), surfaceSeeds: new Map() };
    return buildReadings(this.conn, { charMap, dict, seeds });
  }

  /** 원음 확정이 안 된 char(진짜 다음자·희귀자)를 검수 대상으로 내보낸다 */
  exportReadingChars(seedsPath?: string): Promise<ReadingExport> {
    const seeds = seedsPath ? loadSeeds(seedsPath) : undefined;
    return exportPendingReadingChars(this.conn, { seeds });
  }

  /** char 검수 결과를 적재한다(verified는 확정, failed는 카운트만) */
  importReadingChars(results: ReadingResult[], seedsPath?: string): Promise<ImportStats> {
    const seeds = seedsPath ? loadSeeds(seedsPath) : undefined;
    return importReadingChars(this.conn, results, { seeds });
  }

  /** 연결을 닫는다 */
  close(): void {
    this.conn.client.close();
  }
}

/**
 * 코퍼스를 연다(마이그레이션 포함).
 * @param path - SQLite 파일 경로 또는 ':memory:'
 * @returns HistoryDb 인스턴스
 */
export function openHistoryDb(path: string): Promise<HistoryDb> {
  return HistoryDb.open(path);
}
