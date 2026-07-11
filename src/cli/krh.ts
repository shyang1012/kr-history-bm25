#!/usr/bin/env node
/**
 * @Project: kr-history-bm25
 * @File: krh.ts
 * @Description: krh CLI 엔트리. ingest/translate/search/cluster/place 커맨드를 라이브러리 파사드에 배선한다.
 * @Author: shyang
 * @LastModified: 2026-07-11
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { cac } from 'cac';
import { openHistoryDb, type HistoryDb } from '../history-db';
import { openBundledDb } from '../bundled-db';
import { resolveQueryDbSource } from './resolve-db';
import { createProvider, type ProviderName } from '../translate/create-provider';
import type { BatchTranslationResult } from '../translate/batch';

/** 쓰기 계열(ingest/translate/reading) 기본 DB 경로 */
const DEFAULT_DB = process.env.KRH_DB ?? 'history.sqlite';

/**
 * 조회 명령용 DB를 연다. `--db`·`KRH_DB` 미지정 시 동봉 코퍼스를 기본으로 삼아
 * "설치하자마자 검색"을 보장한다(krh-qrb).
 * @param dbOpt - `--db` 옵션 값(미지정 시 undefined)
 * @returns 검색 준비된 HistoryDb 인스턴스
 */
async function openForQuery(dbOpt?: string): Promise<HistoryDb> {
  const source = resolveQueryDbSource(dbOpt, process.env.KRH_DB);
  return source.kind === 'path' ? openHistoryDb(source.path) : openBundledDb();
}

/** 배치 내보내기 기본 출력 경로 */
const DEFAULT_BATCH_OUT = 'tmp/translate-batch.json';

/** 배치 흐름 기본 provider(구독 모델은 메인 에이전트가 호출하며 codex를 기본으로 삼는다) */
const DEFAULT_BATCH_PROVIDER = 'codex';

/** 텍스트를 지정 길이로 자른다 */
function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * 배치 직역 결과 파일을 읽는다. `[{id,ko}]` 배열, `{results:[{id,ko}]}` 두 형태를 모두 허용한다.
 * @param filePath - 결과 JSON 파일 경로
 * @returns 직역 결과 목록
 */
function readBatchResults(filePath: string): BatchTranslationResult[] {
  const raw: unknown = JSON.parse(readFileSync(filePath, 'utf-8'));
  const list = Array.isArray(raw) ? raw : (raw as { results?: unknown }).results;
  if (!Array.isArray(list)) {
    throw new Error('결과 파일 형식이 올바르지 않습니다(배열 또는 {results:[]} 필요)');
  }
  return list.map((item) => {
    const entry = item as { id: number; ko: string };
    return { id: Number(entry.id), ko: String(entry.ko) };
  });
}

const cli = cac('krh');

cli
  .command('ingest <dir>', 'XML 사서 디렉터리를 주 코퍼스로 적재')
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .option('--code <code>', '코퍼스 코드(미지정 시 파일 접두어)')
  .option('--name <name>', '사서명(미지정 시 폴더명)')
  .action(async (dir: string, opts: { db: string; code?: string; name?: string }) => {
    const db = await openHistoryDb(opts.db);
    const stats = await db.ingest({ dir, code: opts.code, name: opts.name });
    db.close();
    console.log(
      `[ingest] ${stats.name}(${stats.code}) — files=${stats.files} nodes=${stats.nodes} ` +
        `passages=${stats.passages} mentions=${stats.mentions} annotations=${stats.annotations} ` +
        `newEntities=${stats.newEntities}`,
    );
  });

cli
  .command('translate', '미완 본문을 증분 직역(보조 코퍼스)')
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .option('--provider <name>', 'claude|cloudflare|codex', { default: 'claude' })
  .option('--limit <n>', '이번 실행 최대 처리 수')
  .option('--corpus <code>', '코퍼스 코드 제한')
  .action(async (opts: { db: string; provider: string; limit?: string; corpus?: string }) => {
    const db = await openHistoryDb(opts.db);
    const provider = createProvider(opts.provider as ProviderName);
    const stats = await db.translate({
      provider,
      limit: opts.limit ? Number(opts.limit) : undefined,
      corpusCode: opts.corpus,
      onProgress: (done, total) => {
        if (done % 20 === 0 || done === total) {
          console.log(`[translate] ${done}/${total}`);
        }
      },
    });
    db.close();
    console.log(
      `[translate] attempted=${stats.attempted} translated=${stats.translated} ` +
        `failed=${stats.failed} remaining=${stats.remaining}`,
    );
  });

cli
  .command('translate-export', '구독 모델 직역용 대기 본문을 JSON으로 내보내기')
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .option('--provider <name>', '결과를 채택할 provider 이름', { default: DEFAULT_BATCH_PROVIDER })
  .option('--corpus <code>', '코퍼스 코드 제한')
  .option('--limit <n>', '내보낼 최대 본문 수')
  .option('--out <path>', '출력 JSON 경로', { default: DEFAULT_BATCH_OUT })
  .action(
    async (opts: {
      db: string;
      provider: string;
      corpus?: string;
      limit?: string;
      out: string;
    }) => {
      const db = await openHistoryDb(opts.db);
      const result = await db.exportPending({
        provider: opts.provider,
        corpusCode: opts.corpus,
        limit: opts.limit ? Number(opts.limit) : undefined,
      });
      db.close();
      mkdirSync(dirname(opts.out), { recursive: true });
      writeFileSync(opts.out, JSON.stringify(result, null, 2), 'utf-8');
      console.log(
        `[translate-export] provider=${result.provider} count=${result.count} → ${opts.out}`,
      );
    },
  );

cli
  .command('translate-import <file>', '구독 모델 직역 결과 JSON을 적재')
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .option('--provider <name>', '결과를 채택할 provider 이름', { default: DEFAULT_BATCH_PROVIDER })
  .option('--model <name>', '사용 모델명')
  .action(async (file: string, opts: { db: string; provider: string; model?: string }) => {
    const results = readBatchResults(file);
    const db = await openHistoryDb(opts.db);
    const stats = await db.importResults({ provider: opts.provider, model: opts.model, results });
    db.close();
    console.log(
      `[translate-import] imported=${stats.imported} skipped=${stats.skipped} ` +
        `remaining=${stats.remaining}`,
    );
  });

cli
  .command('reading-ingest-unihan <file>', 'Unihan_Readings.txt를 char_reading에 적재')
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .action(async (file: string, opts: { db: string }) => {
    const db = await openHistoryDb(opts.db);
    const stats = await db.ingestUnihan(file);
    db.close();
    console.log(`[reading-ingest-unihan] chars=${stats.chars} readings=${stats.readings}`);
  });

cli
  .command('reading-build', '독음 사전 구축(원음 확정 → 관용 도출)')
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .option('--seeds <path>', '학술시드 JSON', { default: 'data/reading-seeds.json' })
  .option('--dict <glob>', '표준국어대사전 JSON 디렉터리(쉼표 구분 파일 경로)')
  .action(async (opts: { db: string; seeds?: string; dict?: string }) => {
    const db = await openHistoryDb(opts.db);
    const dictPaths = opts.dict ? opts.dict.split(',').map((s) => s.trim()) : undefined;
    const stats = await db.buildReadings({ seedsPath: opts.seeds, dictPaths });
    db.close();
    console.log(
      `[reading-build] entities=${stats.entities} original(confirmed)=${stats.originalConfirmed} ` +
        `draft=${stats.originalDraft} conventional=${stats.conventionalAdopted} ` +
        `has_variant=${stats.variants} reviewChars=${stats.reviewChars.length}`,
    );
  });

cli
  .command('reading-export', '원음 미확정 char(진짜 다음자·희귀자)를 검수용 JSON으로 내보내기')
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .option('--seeds <path>', '학술시드 JSON', { default: 'data/reading-seeds.json' })
  .option('--out <path>', '출력 JSON 경로', { default: 'tmp/reading-review.json' })
  .action(async (opts: { db: string; seeds?: string; out: string }) => {
    const db = await openHistoryDb(opts.db);
    const result = await db.exportReadingChars(opts.seeds);
    db.close();
    mkdirSync(dirname(opts.out), { recursive: true });
    writeFileSync(opts.out, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`[reading-export] count=${result.count} → ${opts.out}`);
  });

cli
  .command('reading-import <file>', 'char 검수 결과 JSON을 적재')
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .option('--seeds <path>', '학술시드 JSON', { default: 'data/reading-seeds.json' })
  .action(async (file: string, opts: { db: string; seeds?: string }) => {
    const raw: unknown = JSON.parse(readFileSync(file, 'utf-8'));
    const list = Array.isArray(raw) ? raw : (raw as { chars?: unknown }).chars;
    if (!Array.isArray(list)) {
      throw new Error('결과 파일 형식이 올바르지 않습니다(배열 또는 {chars:[]} 필요)');
    }
    const db = await openHistoryDb(opts.db);
    const stats = await db.importReadingChars(list as never, opts.seeds);
    db.close();
    console.log(
      `[reading-import] imported=${stats.imported} failed=${stats.failed} remaining=${stats.remaining}`,
    );
  });

cli
  .command('search <term>', '한자(주) 또는 직역(보조) BM25 검색')
  .option('--db <path>', 'SQLite 경로(미지정 시 동봉 코퍼스)')
  .option('--index <index>', 'han|ko', { default: 'han' })
  .option('--limit <n>', '최대 결과 수', { default: '20' })
  .action(async (term: string, opts: { db?: string; index: string; limit: string }) => {
    const db = await openForQuery(opts.db);
    const limit = Number(opts.limit);
    if (opts.index === 'ko') {
      const hits = await db.searchKo(term, { limit });
      for (const h of hits) {
        console.log(
          `[${h.corpusCode}] ${h.nodeId} ${h.score.toFixed(2)}  ${truncate(h.koText ?? '')}`,
        );
      }
      console.log(`(${hits.length}건)`);
    } else {
      const hits = await db.searchHan(term, { limit });
      for (const h of hits) {
        console.log(`[${h.corpusCode}] ${h.nodeId} ${h.score.toFixed(2)}  ${truncate(h.textHan)}`);
      }
      console.log(`(${hits.length}건)`);
    }
    db.close();
  });

cli
  .command('cluster <surface>', '같은 기사에 공기하는 지명·개체(군집)')
  .option('--db <path>', 'SQLite 경로(미지정 시 동봉 코퍼스)')
  .option('--type <type>', '대상 개체 유형')
  .option('--neighbor-type <type>', '이웃 개체 유형(예: 지명)')
  .option('--limit <n>', '최대 이웃 수', { default: '50' })
  .action(
    async (
      surface: string,
      opts: { db?: string; type?: string; neighborType?: string; limit: string },
    ) => {
      const db = await openForQuery(opts.db);
      const neighbors = await db.cluster(surface, {
        type: opts.type,
        neighborType: opts.neighborType,
        limit: Number(opts.limit),
      });
      db.close();
      for (const n of neighbors) {
        console.log(`${String(n.count).padStart(5)}  ${n.type}  ${n.surface}`);
      }
      console.log(`(${neighbors.length}개 이웃)`);
    },
  );

cli
  .command('place <surface>', '표기 출현 위치 구조화 조회')
  .option('--db <path>', 'SQLite 경로(미지정 시 동봉 코퍼스)')
  .option('--type <type>', '개체 유형(지명/이름 등)')
  .option('--limit <n>', '최대 결과 수', { default: '100' })
  .action(async (surface: string, opts: { db?: string; type?: string; limit: string }) => {
    const db = await openForQuery(opts.db);
    const occ = await db.lookupPlace(surface, { type: opts.type, limit: Number(opts.limit) });
    db.close();
    for (const o of occ) {
      console.log(`[${o.corpusCode}] ${o.path}  ${o.nodeTitle ?? ''}`);
    }
    console.log(`(${occ.length}건)`);
  });

cli.help();
cli.version('0.2.1');

async function main(): Promise<void> {
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
}

main().catch((err: unknown) => {
  console.error(`[krh] 오류: ${(err as Error).message}`);
  process.exitCode = 1;
});
