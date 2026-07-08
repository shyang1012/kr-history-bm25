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
import { searchHan, type SearchHanOptions } from './search/search-han';
import { searchKo, type SearchKoOptions } from './search/search-ko';
import { lookupPlace, type LookupOptions } from './search/lookup-place';
import { cluster, type ClusterOptions } from './search/cluster';
import { withVariants, addVariantGroup, type VariantMemberSpec } from './search/variants';
import type {
  SearchHit,
  KoSearchHit,
  PlaceOccurrence,
  ClusterNeighbor,
  VariantSearchResult,
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

  /** 한자 원문 BM25 검색 */
  searchHan(term: string, options?: SearchHanOptions): Promise<SearchHit[]> {
    return searchHan(this.conn.client, term, options);
  }

  /** 직역(보조) BM25 검색 */
  searchKo(term: string, options?: SearchKoOptions): Promise<KoSearchHit[]> {
    return searchKo(this.conn.client, term, options);
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
