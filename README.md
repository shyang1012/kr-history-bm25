# kr-history-bm25

**한국사 사료 원문(한자)을 검색 가능한 SQLite BM25 코퍼스로 변환하는 도구.**
국사편찬위원회 한국사데이터베이스 XML(삼국사기·삼국유사·고려사·고려사절요·한국고대사료집성)을
대상으로, 한자 원문 전문검색을 1차 기준으로 삼고 구조화된 지명·인명 색인, 공기(共起) 군집,
그리고 선택적 LLM 직역 보조 인덱스를 함께 제공한다.

[![npm](https://img.shields.io/npm/v/kr-history-bm25.svg)](https://www.npmjs.com/package/kr-history-bm25)
![license](https://img.shields.io/badge/license-MIT-blue.svg)
![node](https://img.shields.io/badge/node-%3E%3D20-brightgreen.svg)

---

## English Overview

`kr-history-bm25` turns the primary sources of **Korean history** — written in **classical Chinese
(Literary Chinese / Hanja, 漢文)** — into a self-contained, searchable **SQLite BM25 full-text corpus**.

It covers the core historical texts for **Goguryeo, Baekje, Silla, Gaya, Gojoseon, and Goryeo**
(高麗 — read ***Gori*** 고리 in its original reading; the phonetic source of the Western exonym
***Corea / Korea***, whereas "Goryeo" is the later conventional reading) — for early-Korea studies
and **historical-geography / toponym (place-name) identification**:

- ***Samguk Sagi*** (三國史記, *History of the Three Kingdoms*)
- ***Samguk Yusa*** (三國遺事, *Memorabilia of the Three Kingdoms*)
- ***Goryeosa*** (高麗史, *History of Goryeo*; the original reading gives ***Coreasa*** 고리사,
  cf. *Corea/Korea*) and ***Goryeosa Jeoryo*** (高麗史節要)
- **Chinese dynastic-history records on Korea** (한국고대사료집성 / 韓國古代史料集成 — excerpts from
  the *Book of Han* 漢書, *Book of Later Han* 後漢書, *Records of the Three Kingdoms* 三國志, etc.)

Sourced from the **National Institute of Korean History** database (국사편찬위원회 한국사DB).
Built for historians and researchers who work directly with the original text — **in any language**:

- **Hanja-primary full-text search** — BM25 over Literary Chinese, character-unigram tokenized, so
  place names, personal names, offices, and book titles match exactly (the Hanja is the authority).
- **Simplified ⇄ Traditional Chinese search** (简体/繁體) — query in **Simplified Chinese** (e.g.
  `辽东`, `汉城`, `乐浪`) and it is normalized to the traditional/original form (`遼東`, `漢城`, `樂浪`)
  before searching. Results are also annotated with the Simplified form, so a **Chinese-speaking
  researcher** can work in their own script and paste toponyms straight into Google/Baidu Maps.
- **Reading (pronunciation) gloss** — search by Korean reading (e.g. `강감찬`) to reach the Hanja
  (`姜邯贊`); each entity carries a dictionary-headword reading and a conventional reading.
- **Co-occurrence clustering** — identify a toponym by the *cluster* of neighboring place names,
  rivers, and mountains recorded together, not by isolated single-name comparison.
- **Structured place/person index** and **variant-form (異表記) expansion**.
- **MCP server** (`krh-mcp`) — exposes the corpus to LLM clients (Claude, etc.) as callable tools.
- **Pre-built corpus** — `npm install` and query; no XML ingestion required.

```bash
npm install kr-history-bm25
```

```ts
import { openBundledDb } from 'kr-history-bm25';

const db = await openBundledDb();

await db.searchHan('浿水');                          // BM25 over the Hanja original
await db.searchHan('辽东');                          // Simplified query → normalized to 遼東
await db.searchByReading('강감찬');                  // Korean reading → Hanja 姜邯贊 (with readings)
await db.cluster('遼東', { neighborType: '지명' });  // neighboring toponyms (+ Simplified forms)
db.close();
```

The design principle: **the Hanja source is always the authority.** Translations, readings, and
Simplified-Chinese forms are secondary discovery/access layers — never the basis of a conclusion.
The tool surfaces the evidence; the researcher draws the conclusions. See the methodology below.

*Keywords: Korean history, Corea, Korea (高麗 / 고리 *Gori*), classical Chinese, Literary Chinese,
Hanja, full-text search, BM25, historical geography, toponym identification, Samguk Sagi, Samguk
Yusa, Goryeosa / Coreasa (高麗史), Goguryeo, Baekje, Silla, Gojoseon, Lelang/Nakrang (樂浪), Liaodong (遼東),
Simplified/Traditional Chinese, MCP.*

---

## 개요 · 설계 원칙

이 도구는 사료 검색을 넘어 **역사지리 비정(比定)** 연구를 위한 기반이다. 원사료를 최우선 기준으로,
LLM에게 정제된 검색 결과를 제공하는 것을 목표로 한다. 설계는 `source/context.md`의 방법론 원칙을 따른다.

- **사서 원문 최우선.** 신뢰의 기준은 언제나 한자 원문이다. 제공된 한글 번역은 배제한다
  (원문과 무관한 오역 이력 때문). 보조 인덱스는 우리가 직접 직역한 데이터다.
- **후대의 지명 이동·왜곡 가능성**을 항상 전제한다. "역사는 승자의 기록일 수 있다."
- **지명 단독 비교 금지.** 반드시 주변 지명과의 **군집(cluster)** 으로 판단한다 — 동일 반경 내
  행정·방어·교통·산·하천 지명이 함께 존재해야 한다.
- **확정 표현을 쓰지 않는다.** "고신뢰 비정 가능성", "군집 기준에서 가장 일치" 수준만 허용한다.
  AI는 결론 제시자가 아니라 **논증 정리·구조화·검증 보조**다.

> 수계(하천) 위계 코드처럼 사서의 용례를 존중한다: 하(河)=황하급 대하, 강(江)=양자강급,
> 수(水)=중·소 하천, 천(川)=지류·계곡급. 현대 지형 크기로 판단하지 않는다.

---

## 설치 & 빠른 시작

```bash
npm install kr-history-bm25
```

동봉된 사전 구축 코퍼스(`data/history.sqlite.gz`)를 첫 사용 시 자동 해제해 연다. **XML·ingest 불필요.**

```ts
import { openBundledDb } from 'kr-history-bm25';

const db = await openBundledDb(); // 첫 호출: data/history.sqlite로 압축 해제(~1-2초)

// 1) 한자 원문 검색 (주 인덱스) — 지명·인명 등 고유명사에 사용
const byHan = await db.searchHan('浿水', { limit: 10 });

// 2) 한자 원문 검색 — 간자체 질의도 자동 정규화(辽东 → 遼東, 중국어권 연구자)
const bySimp = await db.searchHan('辽东', { limit: 10 });

// 3) 독음 검색 — 한글 독음으로 한자 찾기(강감찬 → 姜邯贊, 대표음·관용 병기)
const byReading = await db.searchByReading('강감찬', { limit: 10 });

// 4) 직역 검색 (보조 인덱스) — 사건·현상·서술어에 사용
const byKo = await db.searchKo('일식', { limit: 10 });

// 5) 공기 군집 — 같은 기사에 함께 등장한 지명 (遼東·玄菟·王險 …). 지명 간자체 병기
const near = await db.cluster('浿水', { neighborType: '지명', limit: 20 });

// 6) 구조화 출현 위치
const occ = await db.lookupPlace('浿水', { type: '지명' });

// 7) 이표기 확장 검색 (예: 졸본=홀본)
const variants = await db.withVariants('卒本');

db.close();
```

> 동봉본은 한자 주 인덱스가 핵심이다. 직역(보조) 인덱스는 `db.translate()`로 증분 생성하며,
> 유지보수자는 `npm run build:corpus`로 `source/`에서 동봉본을 재생성한다.

CLI로도 동일하게 쓸 수 있다:

```bash
npx krh search 浿水 --index han --limit 10
npx krh search 辽东 --index han          # 간자체 질의 → 정자 遼東 자동 정규화
npx krh search 강감찬 --index reading     # 한글 독음 → 姜邯贊(대표음·관용 병기)
npx krh search 일식 --index ko
npx krh cluster 浿水 --neighbor-type 지명 --scope paragraph
npx krh place 浿水 --type 지명
```

---

## 이원 인덱스(dual-index) 설계

검색은 두 개의 독립 BM25 인덱스로 구성된다.

| 인덱스 | 대상 | 언제 쓰나 | 함수 |
|--------|------|-----------|------|
| **주(primary)** | 한자 원문 | 지명·인명·관직 등 **고유명사** — 한자가 authoritative | `searchHan` |
| **보조(secondary)** | LLM 직역(한국어) | 사건·현상·서술어(일식·전쟁·항복 등) — 번역 완료분 한정 | `searchKo` |

**왜 한자가 주인가.** 원문이 신뢰 근거이고 번역은 보조 발견층이다. 고유명사는 한글로 검색하면
재현율이 떨어진다(예: `浿水` 원문검색 vs '패수' 한글검색). 반대로 사건·서술어는 직역이 자연스럽다.

> 실무 요약: **고유명사 → `searchHan`**, **사건·서술어 → `searchKo`**(번역 완료 코퍼스 한정).

---

## BM25 랭킹 (학술)

전문검색 관련도는 **Okapi BM25** 로 계산한다. 질의 $Q = \{q_1, \dots, q_n\}$에 대한 문서 $D$의 점수는:

$$
\text{score}(D, Q) = \sum_{i=1}^{n} \text{IDF}(q_i) \cdot
\frac{f(q_i, D)\,(k_1 + 1)}{f(q_i, D) + k_1 \left(1 - b + b \cdot \dfrac{|D|}{\text{avgdl}}\right)}
$$

역문서빈도(IDF)는 다음과 같다($N$=전체 문서 수, $n(q_i)$=$q_i$를 포함한 문서 수):

$$
\text{IDF}(q_i) = \ln\!\left( \frac{N - n(q_i) + 0.5}{n(q_i) + 0.5} + 1 \right)
$$

기호 정리:

| 기호 | 의미 | 이 프로젝트에서 |
|------|------|------------------|
| $f(q_i, D)$ | 문서 $D$ 안에서 항 $q_i$의 빈도 | passage 내 해당 한자(또는 음절) 빈도 |
| $\lvert D \rvert$ | 문서 길이 | passage 글자수 |
| $\text{avgdl}$ | 평균 문서 길이 | 전체 passage 평균 글자수 |
| $N$ | 전체 문서 수 | 전체 passage 수 |
| $k_1$ | 항 빈도 포화 계수 | **1.2** (SQLite FTS5 기본) |
| $b$ | 길이 정규화 강도 | **0.75** (SQLite FTS5 기본) |

- **문서 단위 = passage.** BM25 문서는 한 문단(passage)이며, 기사(node) 단위 군집은 별도 색인으로 처리한다.
- **엔진 = SQLite FTS5의 내장 `bm25()`.** `tokenize='unicode61'`, external content 방식으로
  `passage` 테이블과 동기화된다.
- **부호 규약(중요).** FTS5의 `bm25()`는 **관련도가 높을수록 더 작은(더 음수인) 값**을 반환한다.
  따라서 정렬은 오름차순(`ORDER BY score`)이며, 반환된 `score`는 "작을수록 관련 높음"으로 해석한다.

```sql
-- src/search/search-han.ts 발췌
SELECT p.id, p.text_han, bm25(passage_fts_han) AS score
  FROM passage_fts_han f
  JOIN passage p ON p.id = f.rowid
 WHERE passage_fts_han MATCH ?
 ORDER BY score          -- 오름차순: 더 음수 = 더 관련
 LIMIT ?;
```

---

## 토큰화 — 왜 글자 단위 unigram인가

고전 한문은 띄어쓰기가 없고, 지명 한자는 **엄격히 구분**해야 한다(동음이의 지명 판별의 전제).
그래서 토큰을 **글자(codepoint) 단위 unigram**으로 색인한다.

```
'卒本川'  →  '卒 本 川'          (색인)
'卒本'    →  "卒 本"             (질의 — phrase로 정확 인접 매칭)
```

- **주 인덱스(한자)**: `hanToUnigram()`이 CJK 한자만 남겨 글자 단위로 분해한다. 확장 B~F 영역
  (surrogate pair, 한국고대사료집성 희귀자)까지 커버한다. 검색어는 `buildPhraseQuery()`로
  큰따옴표 phrase(`"卒 本"`)로 감싸 인접 정확 매칭한다.
- **보조 인덱스(직역)**: `koToUnigram()`이 한글 음절·한자는 글자 단위로, ASCII 영숫자는 런으로
  유지한다(`'BC57년'` → `'BC 57 년'`). 음절 단위 색인으로 **조사 결합을 극복**한다
  (검색어 '일식'이 본문 '일식이'를 매칭).

관련 코드: `src/ingest/tokenizer.ts`.

---

## API 레퍼런스

`openBundledDb()`(동봉본) 또는 `openHistoryDb(path)`(임의 파일)로 `HistoryDb` 핸들을 얻는다.

| 메서드 | 설명 | 반환 |
|--------|------|------|
| `searchHan(term, opts?)` | 한자 원문 BM25 검색(간자체 질의 자동 정규화) | `SearchHit[]` |
| `searchKo(term, opts?)` | 직역(보조) BM25 검색 | `KoSearchHit[]` |
| `searchByReading(query, opts?)` | 한글 독음으로 한자 검색 — 대표음·관용·간자체 병기 | `ReadingSearchResult` |
| `lookupPlace(surface, opts?)` | 표기 출현 위치 구조화 조회 | `PlaceOccurrence[]` |
| `cluster(surface, opts?)` | 공기 개체(군집). `scope`=article(기사)/paragraph(문단). 지명 간자체 병기 | `ClusterNeighbor[]` |
| `withVariants(surface, opts?)` | 이표기 확장 검색 | `VariantSearchResult` |
| `traditionalize(term)` | 간자체 질의를 정자 후보로 확장(투명성 표시용) | `QueryExpansion` |
| `addVariantGroup(members, note?, source?)` | 이표기 그룹 수동 등록 | `number` |
| `close()` | 연결 종료 | `void` |

공통 옵션: `limit`(최대 결과 수), `corpusCode`(코퍼스 제한), `type`/`neighborType`(개체 유형).

```ts
interface SearchHit {
  passageId: number;
  nodeId: string;
  corpusCode: string;
  textHan: string;
  score: number; // FTS5 bm25 — 작을수록 관련 높음
}
```

전체 export는 `src/index.ts` 참조(ingest·translate·reading 파이프라인 API 포함).

---

## CLI 레퍼런스 (`krh`)

```bash
krh <command> [options]     # 전역 옵션: --db <path> (기본 KRH_DB 또는 history.sqlite)
```

| 커맨드 | 설명 |
|--------|------|
| `search <term> --index han\|ko\|reading --limit <n>` | 한자(주)/직역(보조)/독음 검색. han은 간자체 질의 자동 정규화 |
| `cluster <surface> --type --neighbor-type --scope --limit` | 공기 군집(--scope article=기사/paragraph=문단, 지명 간자체 병기) |
| `place <surface> --type --limit` | 표기 출현 위치 조회 |
| `ingest <dir> --code --name` | XML 사서 디렉터리를 주 코퍼스로 적재 |
| `translate --provider --limit --corpus` | 미완 본문 증분 직역 |
| `translate-export` / `translate-import <file>` | 구독 모델 배치 직역 내보내기/적재 |
| `reading-ingest-unihan <file>` / `reading-build` / `reading-export` / `reading-import <file>` | 독음 사전 적재·구축·검수 |

`KRH_DB` 환경변수로 기본 DB 경로를 지정할 수 있다.

---

## MCP 서버 (`krh-mcp`)

동봉 코퍼스를 **MCP(Model Context Protocol) 도구로 LLM 클라이언트에 직접 노출**한다(stdio).
Claude 등에서 검색·군집·조회를 도구로 호출하고, 비정 방법론 가이드를 prompt로 받는다.

**클라이언트 등록 예** (Claude Desktop/Code 등의 MCP 설정):

```json
{
  "mcpServers": {
    "kr-history": { "command": "krh-mcp" }
  }
}
```

전역 설치했다면 `krh-mcp`, 아니면 `npx -y -p kr-history-bm25 krh-mcp`. `KRH_DB` 환경변수를 주면
동봉본 대신 지정 코퍼스를 연다.

**도구 6종** (파사드에 1:1, JSON 반환):

| 도구 | 용도 |
|------|------|
| `search_han` | 한자 원문 BM25 — 지명·인명 등 **고유명사**. **간자체(简体) 질의 자동 정규화** |
| `search_ko` | 직역 BM25 — 일식·전쟁 등 **사건·서술어**(번역 완료분) |
| `search_by_reading` | 한글 독음으로 한자 표기 검색 — **대표음(사전 표제음)·관용 병기** |
| `lookup_place` | 표기 출현 위치 구조화 조회 |
| `cluster` | 같은 기사 공기(共起) 군집 — **지명 간자체 병기** |
| `with_variants` | 이표기 확장 검색(졸본=홀본) |

**가이드 prompt** — `toponym-identification-guide`: 사서 원문·군집·지도 교차로 지명을 비정하는
방법론(확정 표현 금지, 결론은 사람 몫)을 제공한다.

---

## 코퍼스 구성 · 현황

- **한자 BM25 5종** — 삼국사기·삼국유사·고려사·고려사절요·한국고대사료집성(개체 62,421).
- **직역 완료(코어)** — 삼국사기·삼국유사 **6,838건** 직역 → 보조 인덱스 구축 완료.
- **직역 예정** — 고려사·한국고대사료집성·고려사절요 약 **68,022건**.
- **독음 레이어(반영 완료)** — 대표음(사전 표제음) 1차 / 관용 주석. Unihan kHangul(글자 합성) +
  표준국어대사전 관용 + 두음법칙 + 학술 시드 + LLM 예외 검수. 대표음 확정 **59,600/62,421(95.5%)**,
  다음자 118 옥편 판정. 동봉본에 베이킹 완료 → `searchByReading`(한글 독음 → 한자).
- **간자체 레이어(반영 완료)** — Unihan kSimplifiedVariant 6,511 매핑. 정자↔간자체 양방향:
  결과에 간자체 병기(→지도) + 간자체 질의 자동 정규화(→중국어권 검색).
- 동봉 코퍼스 `data/history.sqlite.gz` (~41MB).

---

## 데이터 모델 개요

| 테이블 | 역할 |
|--------|------|
| `corpus` | 사서 단위 |
| `node` | 계층 구조(본기·지리지·열전 …), 기사=군집 단위 |
| `passage` | 문단 = **BM25 문서 단위** |
| `entity` / `entity_mention` | 지명·인명 등 개체와 출현 매핑(구조화 색인) |
| `annotation` | 주석(협주 등) |
| `variant_group` / `variant_member` | 이표기 그룹(졸본=홀본 등) |
| `translation` | 직역 결과(보조 인덱스 원천) |
| `passage_fts_han` / `passage_fts_ko` | FTS5 가상테이블(주/보조 BM25) |

스키마 원본: `src/db/migrations/0001-init.ts` (hand-written SQL, unicode61 FTS5).

---

## 개발

```bash
npm install
npm test          # vitest
npm run build     # tsup → ESM + CJS + d.ts
npm run validate  # lint + format:check + typecheck(tsc --noEmit) + test
```

Node ≥ 20. 드라이버는 `@libsql/client`(+drizzle-orm), FTS5 마이그레이션은 hand-written이다.
개발 규율은 `CW-AP-D03 개발표준정의서`를 준용한다(명명·TDD·SQL·리팩토링 표준).

---

## 로드맵

- ✅ **MCP 서버** (`krh-mcp`) — 도구 6종 + 비정 가이드로 LLM에 직접 노출. (위 절 참조)
- ✅ **독음 검색·병기** — 한글 독음 → 한자(대표음/관용), 검색 결과 병기.
- ✅ **간자체 양방향** — 결과 병기(→지도) + 질의 정규화(→중국어권 접근).
- **하이브리드 검색** — 벡터 KNN(의미 발견층) + BM25 재랭킹, 그 위에 **DBSCAN 군집층**(밀도 기반).
  libsql 네이티브 벡터(동봉 파일 내 F32_BLOB) 활용.
- **퍼지 군집(FDBSCAN)** — 경계·이표기의 군집 소속을 등급(가능성)으로. "확정 금지" 방법론과 정합.
- **웹 UI 시각화** — 지명 군집 force graph, 좌표 플롯, 한자↔직역 병렬 뷰.
- **Python wrapper** — 연구자 파이썬 분석 창구(pandas/scikit-learn 연동). 코어 알고리즘은 TS.

---

## 라이선스 · 출처

- **라이선스: MIT** © shyang.
- **데이터 출처: 국사편찬위원회 한국사 데이터베이스.** 원자료의 권리는 해당 기관에 있으며, 본
  패키지는 검색 색인 구축과 연구 보조를 목적으로 한다.
- 이 도구는 결론을 제시하지 않는다. 모든 비정·해석의 판단은 연구자의 몫이다.
