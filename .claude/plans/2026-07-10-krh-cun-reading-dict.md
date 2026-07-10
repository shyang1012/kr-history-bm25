# krh-cun — 독음 사전 구축 계획 (원음 1차 / 관용 주석)

## Context (왜 이 작업인가)

**확정된 상위 결정 (2026-07-10, PM):**
- 직역 고유명사는 **`독음(한자)` 병기**로 통일한다. 이유는 한글·한자 **양방향 검색 일관성**(`dual-index` 취지). 고유명사가 한자 단독이면 `searchKo`에서 누락된다(실측: `浿水` 5건 vs `패수` 1건).
- 병기의 **선행 엔진**이 독음 사전이다. `entity` 62,421개(이름 36,537·지명 14,160·관직 6,265·국명 2,571·서명 1,814…)에 독음을 확보해야 병기가 가능하다.

**독음 레이어 = 원음 1차 / 관용 주석 (PM 확정, 핵심):**
- **원음(原音)이 primary·authoritative** 이고, **관용독음은 주석**이다. `reading-wonum`("원문 한자가 1차, 독음은 보조")·`trust-principle`과 정합.
- **이유가 연구 방법론이다**: `姜邯贊`의 `邯`을 관용 "감"이 아니라 원음 **"한"**(邯鄲 한단)으로 보존해야, 강씨 지배지역 지명(한산·한성 등)과 인물·가문을 **음차로 추적**할 수 있다. "역사는 지도에 표시 가능해야 실증"이라는 기법에서 원음은 편의 표기가 아니라 **추적 네트워크의 노드**다. `meta-rules`(지명 위계·지도 좌표)·`etymon-khan`(음차 이표기)과 이어진다.
- 예: `高麗` 원음 **고리** / 관용 고려, `鄭麟趾` 원음 **정린지** / 관용 정인지, `金庾信` 원음 **금유신** / 관용 김유신.

**설계 원칙 — evidence-first (`evidence-first-guard`):** 근거 없이 LLM에 맡기면 환각한다. 검증 가능한 규칙·사전으로 기계 확정을 최대화하고, LLM은 '예외 검수'로 강등한다.

**원음 판정의 3분해 (Unihan 실측 기반):** Unihan `kHangul`은 원음·관용 후보를 **다 담지만 라벨링은 안 한다**(`邯`은 관용 "감"을 먼저 놓아 순서로 못 가림). 그래서:
| 부류 | 예 | 원음 확정 방법 |
|---|---|---|
| ① 단일독음 | 高(고)·麻(마) | 원음=관용, **기계** |
| ② 두음법칙 갈림 | 麗(려/여)·麟(린/인)·李(리/이)·柳(류/유) | 원음=본음, 관용=두음, **규칙 기계** + 관용 자동 생성 ★큰 비중 |
| ③ 진짜 다음자 | 邯(한/감)·金(금/김)·車(거/차)·說(설/세/열) | **LLM 옥편판정 + 학술시드(PM) + PM 보정** (소수) |

**이번 Plan 스코프 (PM 확정):** 독음 사전 **구축까지만** (원음·관용 두 레이어 모두 채움). ② 소급 병기 치환(5,923건)과 ③ 규약 B 개정은 **별도 Plan**.

---

## 데이터 모델 (translation 패턴 답습 + reading_type 이중 레이어)

`src/db/migrations/0002-reading.ts` 신규 + `src/db/schema.ts` 확장. DDL 스타일은 `0001-init.ts` 답습.

```sql
-- 글자 독음 (Unihan 원천, 합성 재료). kHangul 복수독음을 seq로 보존(다음자 식별).
CREATE TABLE IF NOT EXISTS char_reading (
    id       INTEGER PRIMARY KEY AUTOINCREMENT
  , char     TEXT NOT NULL          -- 한자 1자
  , reading  TEXT NOT NULL          -- 독음(한글)
  , source   TEXT NOT NULL          -- 'unihan_khangul'
  , seq      INTEGER NOT NULL DEFAULT 0  -- Unihan 표기 순번. char에 행 2개+ = 다음자
  , is_dueum INTEGER NOT NULL DEFAULT 0  -- 이 독음이 두음변화형인지(관용측)
);
CREATE UNIQUE INDEX IF NOT EXISTS char_reading_char_reading_uq ON char_reading (char, reading);
CREATE INDEX IF NOT EXISTS char_reading_char_idx ON char_reading (char);

-- 개체 독음 (이중 레이어). reading_type로 원음/관용 구분, 각 타입별 adopted 1개.
CREATE TABLE IF NOT EXISTS entity_reading (
    id            INTEGER PRIMARY KEY AUTOINCREMENT
  , entity_id     INTEGER NOT NULL
  , reading       TEXT
  , reading_type  TEXT NOT NULL       -- 'original'(원음·primary) | 'conventional'(관용·주석)
  , source        TEXT NOT NULL       -- 'synth' | 'rule' | 'dict' | 'llm' | 'seed'
  , confidence    INTEGER NOT NULL DEFAULT 0
  , status        TEXT NOT NULL DEFAULT 'draft'  -- 'draft'|'auto_confirmed'|'llm_verified'|'seeded'|'failed'
  , adopted       INTEGER NOT NULL DEFAULT 0
  , created_at    TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS entity_reading_uq ON entity_reading (entity_id, reading_type, source);
CREATE INDEX IF NOT EXISTS entity_reading_status_idx ON entity_reading (status);
-- 타입당 채택 1개 불변식을 DB로 강제(재실행 멱등: 재채택 시 기존 adopted=0 해제 후 재지정)
CREATE UNIQUE INDEX IF NOT EXISTS entity_reading_adopted_uq ON entity_reading (entity_id, reading_type) WHERE adopted = 1;
```

- **원음/관용 갈림(has_variant)** 은 저장하지 않고 조회로 도출: `original.adopted.reading ≠ conventional.adopted.reading`. 병기(다음 Plan)에서 이 조건이면 `원음(한자)〔관용 X〕`, 같으면 `원음(한자)`.
- `migrate.ts:9,18` — `import * as reading from './migrations/0002-reading'` + `MIGRATIONS` 배열 append(멱등 증분).

---

## 파이프라인 (2-pass: 원음 확정 → 관용 도출. 각 단계 재실행 가능)

원음(original)을 **먼저 완전히 확정**한 뒤 관용(conventional)을 그 위에서 도출한다(F-01). LLM 검수는 entity가 아니라 **char(글자) 단위**다 — `邯` 1회 판정이 19개 surface에 전파되어 중복·불일치를 없앤다(F-02).

**Pass 1 — 원음(original) 확정:**
1. **Ingest Unihan** → `char_reading`. `kHangul` 파싱, 복수독음 `seq`, 두음변화형 `is_dueum=1` 태깅(여·인·이·유·요 = 본음 려·린·리·류·뇨의 두음형). `is_dueum`은 "이 독음이 두음형"이라는 태그, `dueum.ts`는 본음↔두음 상호변환 함수.
2. **원음 초안(synth)** → 글자별 본음(비두음·`seq=0` 우선) 합성 → `entity_reading(original, synth, draft)`. 단 **진짜 다음자(char 복수독음 & 비두음) 포함 개체는 본음 미확정 → `status='draft'` 유지**(뒤 단계가 이 임시 초안을 채택 소비하지 않는다).
3. **학술시드(char 본음)** → PM 시드(`邯`=한, `麗`=리) → **`char_reading`에 본음 확정** + `entity_reading(original, seed, seeded)`.
4. **선별 LLM 검수 (char 단위)** → 시드·규칙으로 미확정인 **진짜 다음자·희귀자 글자만** export → char 본음 판정 import(`{char, reading, status, note}`) → `char_reading` 확정 반영. 판정 불가 char는 `status='failed'`(silent 누락 0). ★ 검수 대상은 entity(62,421)가 아니라 문제 글자(수백).
5. **원음 채택(adopted)** → 확정된 char 본음으로 surface 재합성 → 우선순위 `seed > llm > synth(단일/두음)`로 `adopted=1`. **failed char 포함 개체는 non-adopted + `status='failed'`.**

**Pass 2 — 관용(conventional) 도출 (확정된 원음 기반):**
6. **관용 도출·채택** → 채택된 original 기준: (a) 표준국어대사전 surface 정확일치 → `dict`; (b) 두음법칙 적용(본음→두음, 려→여) → `rule`; (c) 둘 다 무 → **원음 복사** → `rule`. `adopted=1`. **original 채택이 갱신되면 conventional 재계산(refresh)** — 두 레이어 정합 유지.

**채택 멱등:** `reading_type`별 `adopted=1`은 partial unique(`WHERE adopted=1`)로 DB 강제. 재채택 트랜잭션은 `translation-store.adopt` 답습 — `UPDATE adopted=0 WHERE entity_id=? AND reading_type=?` 후 `INSERT ... ON CONFLICT DO UPDATE`.

**자동확정 게이트 (Pass 1 step 2 분류):**
- surface 전 글자가 ①단일 또는 ②두음 규칙으로만 설명 → `synth` 기계 확정 `auto_confirmed`, **LLM 스킵**.
- ③진짜 다음자 또는 희귀자(kHangul 없음) char 포함 → 그 **char를 LLM 검수 큐**로. 학술시드가 이미 덮으면 스킵.

---

## 구현 단위 (TDD, 이 순서로)

`superpowers:test-driven-development` 준수(테스트 먼저). 픽스처는 `batch.test.ts` 답습(`createDbConnection(':memory:')`→`runMigrations`). **주의: 아래 표는 빌드 순서(bottom-up — 저장소·시드·배치를 채택 로직보다 먼저 만든다)이며, 런타임 실행 순서는 2-pass 파이프라인(Pass1: ingest→합성→시드→char검수→원음채택 / Pass2: 관용도출·채택)을 따른다.**

| # | 작업 | 신규/수정 파일 | 답습 |
|---|---|---|---|
| 1 | 마이그레이션·스키마 | `src/db/migrations/0002-reading.ts`(신규), `schema.ts`·`migrate.ts`(수정) | `0001-init.ts`, `entity`/`translation` |
| 2 | Unihan ingest + 두음 태깅 | `src/reading/ingest-unihan.ts` | .mjs 파싱 |
| 3 | 두음법칙 규칙 | `src/reading/dueum.ts` (본음↔두음 상호변환, 순수함수) | — |
| 4 | 원음 합성 | `src/reading/synthesize.ts` | 순수함수 |
| 5 | 관용 도출·사전 | `src/reading/conventional.ts`, `src/reading/dict-source.ts` | 표준국어대사전 JSON 파서 |
| 6 | 저장소·채택 게이트 | `src/reading/reading-store.ts` | `translation-store.ts`(raw client, `ON CONFLICT`, `client.batch`) |
| 7 | 학술시드 로더 | `src/reading/seed.ts` + `data/reading-seeds.json` | — |
| 8 | 선별 LLM 검수 배치 (**char 단위**) | `src/reading/batch.ts` | `translate/batch.ts`의 resume/skip는 답습, 결과 스키마는 **독립** `{char, reading, status, note}`(verified/failed 명시). export=미확정 char 목록, import=char_reading 확정 |
| 9 | 파사드·CLI·배럴 | `history-db.ts`·`cli/krh.ts`·`index.ts`(수정) | `translate-export/import` cac, `readBatchResults` |
| 10 | 프리빌드 스크립트 | `scripts/build-readings.mjs`(신규) | `build-corpus.mjs` |
| 11 | 테스트 | `tests/reading.test.ts` | `batch.test.ts` |

**두음법칙 주의:** 성씨 예외 많음(李=이/리, 柳=유/류) — 규칙은 원음↔관용 상호도출만, 확정은 원음측 `seed>llm`, 관용측 `dict`가 규칙을 덮는다.

**학술시드 파일(`data/reading-seeds.json`):** `{ "邯": {"original":"한","note":"邯鄲 한단"}, "麗": {"original":"리","context":"국명"} }` 형태. PM이 점증 관리, git 포함(권위 데이터).

---

## 데이터 소스 배치

- **Unihan**: `source/unihan/Unihan_Readings.txt` (git 제외). 없으면 UCD 재다운로드 헬퍼(8.5MB zip은 scratchpad 확보됨).
- **표준국어대사전**: `source/전체 내려받기_표준국어대사전_JSON_20260706/` (이미 존재·git 제외).
- **학술시드**: `data/reading-seeds.json` (git 포함).

---

## 성공 기준

- `entity` 62,421개 **전부 tracked**. **확정 가능한(resolvable) 개체만** original+conventional `adopted=1`. 확정 불가(희귀자 독음 부재 등)는 **non-adopted + `status='failed'`** 명시 — 100% 확정이 아니라 **100% 추적**(silent 누락 0). K>0이어도 성공기준 위배 아님.
- `has_variant`(원음≠관용) 조회·병기 SQL(다음 Plan)은 **failed/non-adopted를 허용하는 left-join** 전제로 설계 — 미채택 row에서 `adopted=1` inner-join이 깨지지 않게 한다.
- 리포트: 기계확정 N / 두음규칙 N / 사전 N / 시드 N / LLM검수 M / 실패 K (silent 누락 금지). `has_variant` 개체 수·목록.
- **스팟체크 정답**: `姜邯贊`→원음 강한찬·관용 강감찬, `高麗`→고리·고려, `鄭麟趾`→정린지·정인지, `金庾信`→금유신·김유신.

## 검증 방법 (end-to-end)

1. `npm run validate` — lint+format:check+typecheck+test 4게이트(`quality-gate`).
2. `tests/reading.test.ts` — `:memory:` DB에 마이그레이션→ingest→두음규칙→합성→관용도출→시드→채택 왕복 + export/import resume·skip.
3. CLI 실측: `krh reading-build --db data/history.sqlite` → 커버리지·has_variant 리포트. `krh reading-export`→검수→`krh reading-import`.
4. 스팟체크 SQL (failed 개체도 보이도록 left-join):
   `SELECT e.surface, r.reading_type, r.reading, r.source, r.status FROM entity e LEFT JOIN entity_reading r ON r.entity_id=e.id AND r.adopted=1 WHERE e.surface IN ('姜邯贊','高麗','鄭麟趾','金庾信') ORDER BY e.surface, r.reading_type;`

## 커밋·이관

- bd `krh-cun` 진행 표시(`bd update krh-cun --claim`), 원음 1차 결정·방법론 근거를 bd memory에 기록.
- 완료 후 이 계획서를 프로젝트 `.claude/plans/`로 이관·커밋.
