/**
 * @Project: kr-history-bm25
 * @File: schema.ts
 * @Description: Drizzle ORM SQLite 스키마. 주 코퍼스(한자)·구조화 색인·보조 코퍼스(직역) 관계형 테이블 정의.
 *               FTS5 가상테이블·트리거는 hand-written 마이그레이션(migrations/0001-init.ts)에서 관리한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import {
  sqliteTable,
  text,
  integer,
  blob,
  index,
  uniqueIndex,
  primaryKey,
} from 'drizzle-orm/sqlite-core';

/** 사서(코퍼스) — XML 5종 각 1행 (삼국사기·삼국유사·고려사·고려사절요·한국고대사료집성) */
export const corpus = sqliteTable('corpus', {
  /** 코퍼스ID · PK · 자동증가 */
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** 코퍼스 코드 · 고유 · 파일 접두어 기반(sg/sy/kr/kj/ko) */
  code: text('code').notNull().unique(),
  /** 사서명 · 예: 삼국사기 */
  name: text('name').notNull(),
  /** 🔴 이 코퍼스가 무엇인가 — 소비자(LLM)가 출처 성격을 추측하지 않게 한다(corpus-registry가 단일 소스) */
  description: text('description'),
  /** 원본 디렉터리 경로 */
  sourceDir: text('source_dir').notNull(),
  /** DTD 버전 표기 · nullable */
  dtdVersion: text('dtd_version'),
  /** ingest 완료 시각 · ISO8601 문자열 */
  ingestedAt: text('ingested_at'),
});

/** 계층 노드 — level1~6 트리(권·기사 등). 군집(co-occurrence)의 기본 단위(기사=leaf node) */
export const node = sqliteTable(
  'node',
  {
    /** 노드ID · PK · 원본 XML id(예: sg_001_0010) */
    id: text('id').primaryKey(),
    /** 코퍼스ID · FK → corpus.id */
    corpusId: integer('corpus_id').notNull(),
    /** 상위 노드ID · FK → node.id · 루트는 null */
    parentId: text('parent_id'),
    /** 레벨 번호 · 1~6 */
    levelNo: integer('level_no').notNull(),
    /** 노드 유형 · DTD type 속성(년/월/일/지리지 등) */
    type: text('type'),
    /** DTD value 속성 */
    value: text('value'),
    /** 왕명 · DTD 왕명 속성 */
    wangmyeong: text('wangmyeong'),
    /** 재위년도 · DTD 재위년도 속성 */
    reignYear: text('reign_year'),
    /** 노드 제목 · mainTitle 등 */
    title: text('title'),
    /** materialized path · 루트→현재(예: sg_001/sg_001_0010) */
    path: text('path').notNull(),
    /** 형제 내 순번 */
    seq: integer('seq').notNull(),
  },
  (t) => ({
    corpusIdx: index('node_corpus_idx').on(t.corpusId),
    parentIdx: index('node_parent_idx').on(t.parentId),
  }),
);

/** 본문 단위(paragraph) — BM25 문서 단위 */
export const passage = sqliteTable(
  'passage',
  {
    /** 본문ID · PK · 자동증가(=FTS rowid) */
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 코퍼스ID · FK → corpus.id */
    corpusId: integer('corpus_id').notNull(),
    /** 소속 노드ID · FK → node.id(기사 단위) */
    nodeId: text('node_id').notNull(),
    /** 노드 내 문단 순번 */
    seq: integer('seq').notNull(),
    /** 한자 원문 · 표점 포함(표시·원본 보존용) */
    textHan: text('text_han').notNull(),
    /** 색인용 unigram 문자열 · 공백 구분 한자(FTS5 소스) */
    hanIndexed: text('han_indexed').notNull(),
    /** 한자 글자 수 */
    charCount: integer('char_count').notNull(),
  },
  (t) => ({
    nodeIdx: index('passage_node_idx').on(t.nodeId),
    corpusIdx: index('passage_corpus_idx').on(t.corpusId),
  }),
);

/** 색인 표제 — <index> 태그에서 추출한 지명·인물 등 고유 개체 */
export const entity = sqliteTable(
  'entity',
  {
    /** 개체ID · PK · 자동증가 */
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 개체 유형 · 지명/이름/국명/관서/서명 등(DTD p.index) */
    type: text('type').notNull(),
    /** 표기 · 한자 원자 그대로(정규화 없음, 엄격 구분) */
    surface: text('surface').notNull(),
  },
  (t) => ({
    typeSurfaceUq: uniqueIndex('entity_type_surface_uq').on(t.type, t.surface),
  }),
);

/** 색인 출현 — 개체가 특정 본문에 등장한 위치(군집·조회의 기반) */
export const entityMention = sqliteTable(
  'entity_mention',
  {
    /** 출현ID · PK · 자동증가 */
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 개체ID · FK → entity.id */
    entityId: integer('entity_id').notNull(),
    /** 본문ID · FK → passage.id */
    passageId: integer('passage_id').notNull(),
    /** 노드ID · FK → node.id(군집 집계 키) */
    nodeId: text('node_id').notNull(),
    /** 코퍼스ID · FK → corpus.id */
    corpusId: integer('corpus_id').notNull(),
    /** 본문 내 문자 오프셋 */
    charOffset: integer('char_offset').notNull(),
    /** <index> 부가 속성 JSON · sort/num/name 등 */
    attrs: text('attrs'),
  },
  (t) => ({
    entityIdx: index('mention_entity_idx').on(t.entityId),
    nodeIdx: index('mention_node_idx').on(t.nodeId),
    passageIdx: index('mention_passage_idx').on(t.passageId),
  }),
);

/** 주석(교감주·원주 등) — 본문과 분리 보존(FTS 색인 제외, LLM 참고용) */
export const annotation = sqliteTable(
  'annotation',
  {
    /** 주석ID · PK · 자동증가 */
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 본문ID · FK → passage.id */
    passageId: integer('passage_id').notNull(),
    /** 주석 유형 · 교감주/원주 등(DTD annotation@type) */
    type: text('type'),
    /** 주석 본문 텍스트 */
    text: text('text').notNull(),
  },
  (t) => ({
    passageIdx: index('annotation_passage_idx').on(t.passageId),
  }),
);

/** 이표기 그룹 — 동일 지명의 복수 한자 표기(예: 졸본=홀본) 묶음 */
export const variantGroup = sqliteTable('variant_group', {
  /** 그룹ID · PK · 자동증가 */
  id: integer('id').primaryKey({ autoIncrement: true }),
  /** 근거·비고 · 사서 명시 출처 등 */
  note: text('note'),
  /** 출처 구분 · manual/사서명 */
  source: text('source'),
});

/** 이표기 멤버 — 그룹↔개체 연결 */
export const variantMember = sqliteTable(
  'variant_member',
  {
    /** 그룹ID · FK → variant_group.id */
    groupId: integer('group_id').notNull(),
    /** 개체ID · FK → entity.id */
    entityId: integer('entity_id').notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.groupId, t.entityId] }),
    entityIdx: index('variant_member_entity_idx').on(t.entityId),
  }),
);

/** 직역(보조 인덱스) — passage별 LLM 직역 결과. 증분·재개 상태 관리 */
export const translation = sqliteTable(
  'translation',
  {
    /** 직역ID · PK · 자동증가 */
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 본문ID · FK → passage.id */
    passageId: integer('passage_id').notNull(),
    /** provider · claude/codex/cloudflare */
    provider: text('provider').notNull(),
    /** 사용 모델명 */
    model: text('model'),
    /** 직역 텍스트 */
    text: text('text'),
    /** 상태 · pending/done/failed */
    status: text('status').notNull().default('pending'),
    /** 채택 여부 · 0/1(보조 FTS 색인 대상) */
    adopted: integer('adopted').notNull().default(0),
    /** 생성 시각 · ISO8601 */
    createdAt: text('created_at'),
  },
  (t) => ({
    passageProviderUq: uniqueIndex('translation_passage_provider_uq').on(t.passageId, t.provider),
    statusIdx: index('translation_status_idx').on(t.status),
  }),
);

/** 글자 독음(char) — Unihan kHangul 원천. 개체 독음 합성의 재료. 복수 독음은 seq로 다음자(多音字) 식별 */
export const charReading = sqliteTable(
  'char_reading',
  {
    /** 독음ID · PK · 자동증가 */
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 한자 1자 */
    char: text('char').notNull(),
    /** 독음(한글) */
    reading: text('reading').notNull(),
    /** 출처 · unihan_khangul 등 */
    source: text('source').notNull(),
    /** Unihan 표기 순번 · 한 char에 행 2개+ = 다음자 */
    seq: integer('seq').notNull().default(0),
    /** 이 독음이 두음변화형인지(관용측) · 0/1 */
    isDueum: integer('is_dueum').notNull().default(0),
  },
  (t) => ({
    charReadingUq: uniqueIndex('char_reading_char_reading_uq').on(t.char, t.reading),
    charIdx: index('char_reading_char_idx').on(t.char),
  }),
);

/** 개체 독음 — 원음(original·primary)/관용(conventional·주석) 이중 레이어. reading_type별 adopted 1개(partial unique는 마이그레이션이 관리) */
export const entityReading = sqliteTable(
  'entity_reading',
  {
    /** 독음ID · PK · 자동증가 */
    id: integer('id').primaryKey({ autoIncrement: true }),
    /** 개체ID · FK → entity.id */
    entityId: integer('entity_id').notNull(),
    /** 독음(한글) · 확정 불가 시 null */
    reading: text('reading'),
    /** 레이어 · 'original'(원음·primary) | 'conventional'(관용·주석) */
    readingType: text('reading_type').notNull(),
    /** 출처 · 'synth' | 'rule' | 'dict' | 'llm' | 'seed' */
    source: text('source').notNull(),
    /** 신뢰도 점수 */
    confidence: integer('confidence').notNull().default(0),
    /** 상태 · 'draft'|'auto_confirmed'|'llm_verified'|'seeded'|'failed' */
    status: text('status').notNull().default('draft'),
    /** 채택 여부 · 0/1(타입별 1개) */
    adopted: integer('adopted').notNull().default(0),
    /** 생성 시각 · ISO8601 */
    createdAt: text('created_at'),
  },
  (t) => ({
    entityReadingUq: uniqueIndex('entity_reading_uq').on(t.entityId, t.readingType, t.source),
    statusIdx: index('entity_reading_status_idx').on(t.status),
  }),
);

/** 의미 벡터(passage) — e5-small int8 정규화 벡터. kind='han'(원문)|'ko'(직역). (passage_id,kind) 복합 PK */
export const passageEmbedding = sqliteTable(
  'passage_embedding',
  {
    /** 본문ID · FK → passage.id */
    passageId: integer('passage_id').notNull(),
    /** 임베딩 대상 · 'han'(원문 한자) | 'ko'(직역 한국어) */
    kind: text('kind').notNull(),
    /** int8 양자화 벡터(round(v*127)) · dim byte BLOB */
    vec: blob('vec', { mode: 'buffer' }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.passageId, t.kind] }),
  }),
);

/** 임베딩 메타 — 단일행(id=1). 로드 시 model·dim 호환 검증용 */
export const embeddingMeta = sqliteTable('embedding_meta', {
  /** 고정 1 */
  id: integer('id').primaryKey(),
  /** 임베딩 모델 식별자 */
  model: text('model').notNull(),
  /** 벡터 차원 */
  dim: integer('dim').notNull(),
  /** 양자화 방식 · 'int8' 등 */
  quant: text('quant').notNull(),
  /** 빌드 시각 · ISO8601 */
  builtAt: text('built_at').notNull(),
});
