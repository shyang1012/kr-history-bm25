#!/usr/bin/env node
/**
 * @Project: kr-history-bm25
 * @File: krh.ts
 * @Description: krh CLI 엔트리. ingest/translate/search/cluster/place 커맨드를 라이브러리 파사드에 배선한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { cac } from 'cac';
import { openHistoryDb } from '../history-db';
import { createProvider, type ProviderName } from '../translate/create-provider';

/** 기본 DB 경로 */
const DEFAULT_DB = process.env.KRH_DB ?? 'history.sqlite';

/** 텍스트를 지정 길이로 자른다 */
function truncate(text: string, max = 60): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
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
  .command('search <term>', '한자(주) 또는 직역(보조) BM25 검색')
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .option('--index <index>', 'han|ko', { default: 'han' })
  .option('--limit <n>', '최대 결과 수', { default: '20' })
  .action(async (term: string, opts: { db: string; index: string; limit: string }) => {
    const db = await openHistoryDb(opts.db);
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
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .option('--type <type>', '대상 개체 유형')
  .option('--neighbor-type <type>', '이웃 개체 유형(예: 지명)')
  .option('--limit <n>', '최대 이웃 수', { default: '50' })
  .action(
    async (
      surface: string,
      opts: { db: string; type?: string; neighborType?: string; limit: string },
    ) => {
      const db = await openHistoryDb(opts.db);
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
  .option('--db <path>', 'SQLite 경로', { default: DEFAULT_DB })
  .option('--type <type>', '개체 유형(지명/이름 등)')
  .option('--limit <n>', '최대 결과 수', { default: '100' })
  .action(async (surface: string, opts: { db: string; type?: string; limit: string }) => {
    const db = await openHistoryDb(opts.db);
    const occ = await db.lookupPlace(surface, { type: opts.type, limit: Number(opts.limit) });
    db.close();
    for (const o of occ) {
      console.log(`[${o.corpusCode}] ${o.path}  ${o.nodeTitle ?? ''}`);
    }
    console.log(`(${occ.length}건)`);
  });

cli.help();
cli.version('0.1.0');

async function main(): Promise<void> {
  cli.parse(process.argv, { run: false });
  await cli.runMatchedCommand();
}

main().catch((err: unknown) => {
  console.error(`[krh] 오류: ${(err as Error).message}`);
  process.exitCode = 1;
});
