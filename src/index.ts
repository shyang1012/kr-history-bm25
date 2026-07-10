/**
 * @Project: kr-history-bm25
 * @File: index.ts
 * @Description: 공개 API 배럴. 파사드·검색 함수·번역 provider·타입을 재노출한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
export { openHistoryDb, HistoryDb } from './history-db';
export { openBundledDb, findDataDir, type OpenBundledOptions } from './bundled-db';
export { createDbConnection, type DbConnection } from './db/client';
export { runMigrations } from './db/migrate';

export { ingestCorpus, type IngestOptions, type IngestStats } from './ingest/ingest-corpus';
export { hanToUnigram, buildPhraseQuery, isCjk } from './ingest/tokenizer';

export { searchHan, type SearchHanOptions } from './search/search-han';
export { searchKo, type SearchKoOptions } from './search/search-ko';
export { lookupPlace, type LookupOptions } from './search/lookup-place';
export { cluster, type ClusterOptions } from './search/cluster';
export {
  withVariants,
  addVariantGroup,
  expandVariants,
  type VariantMemberSpec,
} from './search/variants';

export {
  translateCorpus,
  type TranslateOptions,
  type TranslateStats,
} from './translate/translate-corpus';
export {
  exportPending,
  importResults,
  type ExportPendingOptions,
  type ExportPassage,
  type ExportPendingResult,
  type BatchTranslationResult,
  type ImportResultsOptions,
  type ImportResultsStats,
} from './translate/batch';
export {
  type TranslationProvider,
  type TranslationResult,
  type PassageContext,
  buildMessages,
  DIRECT_TRANSLATION_SYSTEM,
} from './translate/provider';
export { createProvider, type ProviderName } from './translate/create-provider';
export { ClaudeProvider } from './translate/providers/claude';
export { CloudflareProvider } from './translate/providers/cloudflare';
export { CodexProvider } from './translate/providers/codex';

export type {
  ParsedDocument,
  ParsedNode,
  ParsedPassage,
  ParsedMention,
  ParsedAnnotation,
  SearchHit,
  KoSearchHit,
  VariantSearchResult,
  ClusterNeighbor,
  PlaceOccurrence,
} from './types';
export { parseDocument } from './parser/document-parser';

// 독음 사전(krh-cun) — 원음 1차 / 관용 주석
export { ingestUnihan, type IngestUnihanResult } from './reading/ingest-unihan';
export { toDueum } from './reading/dueum';
export { synthesizeOriginal, type CharCandidate, type SynthResult } from './reading/synthesize';
export { deriveConventional, type ConventionalResult } from './reading/conventional';
export { buildDictIndex } from './reading/dict-source';
export { loadCharMap, adoptReading, saveDraft, type ReadingInput } from './reading/reading-store';
export { loadSeeds, type Seeds, type SeedEntry } from './reading/seed';
export { buildReadings, type BuildStats } from './reading/build-readings';
export {
  exportPendingReadingChars,
  importReadingChars,
  type PendingChar,
  type ReadingExport,
  type ReadingResult,
  type ImportStats,
} from './reading/batch';
