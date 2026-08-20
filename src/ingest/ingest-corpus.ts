/**
 * @Project: kr-history-bm25
 * @File: ingest-corpus.ts
 * @Description: 사서 디렉터리(XML 다수)를 파싱해 주 코퍼스(한자)와 구조화 색인을 SQLite에 적재한다.
 *               대량 삽입은 명시적 ID 선할당 + libsql batch 트랜잭션으로 처리한다. (CW-AP-D03 §11-0 perf 케이스)
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { Client, InStatement } from '@libsql/client';
import type { DbConnection } from '../db/client';
import type { ParsedDocument } from '../types';
import { parseDocument } from '../parser/document-parser';
import { hanToUnigram } from './tokenizer';
import { EntityCache, type PendingEntity } from '../entity/entity-repo';
import { registryDescription } from '../corpus/corpus-registry';

/** ingest 옵션 */
export interface IngestOptions {
  /** 사서 XML 디렉터리 경로 */
  dir: string;
  /** 코퍼스 코드(미지정 시 첫 XML 접두어에서 유도) */
  code?: string;
  /** 사서명(미지정 시 폴더명에서 유도) */
  name?: string;
  /** batch flush 임계 문장 수 */
  chunkSize?: number;
}

/** ingest 결과 통계 */
export interface IngestStats {
  corpusId: number;
  code: string;
  name: string;
  files: number;
  nodes: number;
  passages: number;
  mentions: number;
  annotations: number;
  newEntities: number;
}

const DEFAULT_CHUNK = 800;

/**
 * 사서 디렉터리를 ingest한다.
 * @param conn - DB 연결
 * @param options - ingest 옵션
 * @returns 적재 통계
 */
export async function ingestCorpus(
  conn: DbConnection,
  options: IngestOptions,
): Promise<IngestStats> {
  const { client } = conn;
  const files = readdirSync(options.dir)
    .filter((f) => f.toLowerCase().endsWith('.xml'))
    .sort();
  const firstFile = files[0];
  if (firstFile === undefined) {
    throw new Error(`XML 파일이 없습니다: ${options.dir}`);
  }

  const code = options.code ?? deriveCode(firstFile);
  const name = options.name ?? deriveName(options.dir);
  const corpusId = await upsertCorpus(client, code, name, options.dir);
  await purgeCorpus(client, corpusId);

  const entities = new EntityCache();
  await entities.load(client);
  let nextPassageId = await nextId(client, 'passage');

  const buffer: InStatement[] = [];
  const chunkSize = options.chunkSize ?? DEFAULT_CHUNK;
  const stats: IngestStats = {
    corpusId,
    code,
    name,
    files: files.length,
    nodes: 0,
    passages: 0,
    mentions: 0,
    annotations: 0,
    newEntities: 0,
  };

  const flush = async (): Promise<void> => {
    const pending = entities.drainPending();
    const stmts = [...pending.map(entityStmt), ...buffer];
    buffer.length = 0;
    if (stmts.length > 0) {
      await client.batch(stmts, 'write');
      stats.newEntities += pending.length;
    }
  };

  for (const file of files) {
    const xml = readFileSync(join(options.dir, file), 'utf-8');
    const doc = parseDocument(xml);
    nextPassageId = collectStatements(doc, corpusId, nextPassageId, entities, buffer, stats);
    if (buffer.length >= chunkSize) {
      await flush();
    }
  }
  await flush();

  await client.execute({
    sql: 'UPDATE corpus SET ingested_at = ? WHERE id = ?',
    args: [new Date().toISOString(), corpusId],
  });
  return stats;
}

/**
 * 파싱 문서를 INSERT 문장으로 변환해 buffer에 적재한다.
 * @returns 다음 passage id
 */
function collectStatements(
  doc: ParsedDocument,
  corpusId: number,
  startPassageId: number,
  entities: EntityCache,
  buffer: InStatement[],
  stats: IngestStats,
): number {
  let passageId = startPassageId;
  for (const node of doc.nodes) {
    buffer.push({
      sql: `INSERT OR REPLACE INTO node
              (id, corpus_id, parent_id, level_no, type, value, wangmyeong, reign_year, title, path, seq)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        node.id,
        corpusId,
        node.parentId,
        node.levelNo,
        node.type,
        node.value,
        node.wangmyeong,
        node.reignYear,
        node.title,
        node.path,
        node.seq,
      ],
    });
    stats.nodes += 1;
  }

  for (const passage of doc.passages) {
    const id = passageId;
    passageId += 1;
    const hanIndexed = hanToUnigram(passage.textHan);
    const charCount = hanIndexed.length === 0 ? 0 : hanIndexed.split(' ').length;
    buffer.push({
      sql: `INSERT INTO passage
              (id, corpus_id, node_id, seq, text_han, han_indexed, char_count)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
      args: [id, corpusId, passage.nodeId, passage.seq, passage.textHan, hanIndexed, charCount],
    });
    stats.passages += 1;

    for (const mention of passage.mentions) {
      const entityId = entities.resolve(mention.type, mention.surface);
      buffer.push({
        sql: `INSERT INTO entity_mention
                (entity_id, passage_id, node_id, corpus_id, char_offset, attrs)
              VALUES (?, ?, ?, ?, ?, ?)`,
        args: [
          entityId,
          id,
          passage.nodeId,
          corpusId,
          mention.charOffset,
          mention.attrs ? JSON.stringify(mention.attrs) : null,
        ],
      });
      stats.mentions += 1;
    }

    for (const ann of passage.annotations) {
      buffer.push({
        sql: 'INSERT INTO annotation (passage_id, type, text) VALUES (?, ?, ?)',
        args: [id, ann.type, ann.text],
      });
      stats.annotations += 1;
    }
  }
  return passageId;
}

/** 신규 개체 INSERT 문장 */
function entityStmt(e: PendingEntity): InStatement {
  return {
    sql: 'INSERT INTO entity (id, type, surface) VALUES (?, ?, ?)',
    args: [e.id, e.type, e.surface],
  };
}

/**
 * 코퍼스를 upsert하고 corpus_id를 반환한다.
 * 설명(description)은 레지스트리 등재 코드일 때만 기록한다 — 미등재(사용자 자체 코퍼스)는 null로 두어
 * 소비자가 성격을 지어내지 않게 한다(krh-i2o).
 */
async function upsertCorpus(
  client: Client,
  code: string,
  name: string,
  sourceDir: string,
): Promise<number> {
  const description = registryDescription(code);
  const found = await client.execute({
    sql: 'SELECT id FROM corpus WHERE code = ?',
    args: [code],
  });
  if (found.rows[0] !== undefined) {
    const id = Number(found.rows[0].id);
    await client.execute({
      sql: `UPDATE corpus
               SET name        = ?
                 , source_dir  = ?
                 , description = COALESCE(?, description)
             WHERE id = ?`,
      args: [name, sourceDir, description, id],
    });
    return id;
  }
  const inserted = await client.execute({
    sql: 'INSERT INTO corpus (code, name, source_dir, description) VALUES (?, ?, ?, ?)',
    args: [code, name, sourceDir, description],
  });
  return Number(inserted.lastInsertRowid);
}

/** 재적재를 위해 기존 코퍼스의 본문·노드·색인·주석·직역을 삭제한다 */
async function purgeCorpus(client: Client, corpusId: number): Promise<void> {
  await client.batch(
    [
      {
        sql: 'DELETE FROM annotation WHERE passage_id IN (SELECT id FROM passage WHERE corpus_id = ?)',
        args: [corpusId],
      },
      {
        sql: `DELETE FROM passage_fts_ko
               WHERE passage_id IN (SELECT id FROM passage WHERE corpus_id = ?)`,
        args: [corpusId],
      },
      {
        sql: 'DELETE FROM translation WHERE passage_id IN (SELECT id FROM passage WHERE corpus_id = ?)',
        args: [corpusId],
      },
      { sql: 'DELETE FROM entity_mention WHERE corpus_id = ?', args: [corpusId] },
      { sql: 'DELETE FROM passage WHERE corpus_id = ?', args: [corpusId] },
      { sql: 'DELETE FROM node WHERE corpus_id = ?', args: [corpusId] },
    ],
    'write',
  );
}

/** 테이블의 다음 자동증가 id(=max+1)를 구한다 */
async function nextId(client: Client, table: 'passage'): Promise<number> {
  const row = await client.execute(`SELECT COALESCE(MAX(id), 0) AS m FROM ${table}`);
  return Number(row.rows[0]?.m ?? 0) + 1;
}

/** 첫 XML 파일명 접두어에서 코퍼스 코드를 유도한다(sg_001.xml → sg) */
function deriveCode(fileName: string): string {
  const underscore = fileName.indexOf('_');
  return underscore > 0 ? fileName.slice(0, underscore) : fileName.replace(/\.xml$/i, '');
}

/** 폴더명에서 사서명을 유도한다(…정보_삼국사기 원문_… → 삼국사기) */
function deriveName(dir: string): string {
  const base =
    dir
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? dir;
  const matched = base.match(/정보_(.+?)\s*원문/);
  return matched && matched[1] ? matched[1].trim() : base;
}
