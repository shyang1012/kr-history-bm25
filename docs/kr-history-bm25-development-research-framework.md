# kr-history-bm25 개발 방향 및 연구 프레임워크

> **문서 위상** — 이 문서는 `kr-history-bm25` **v0.2.1 코드베이스를 실측한 기준선** 위에 세운 권위 문서다.
> "무엇이 이미 되어 있고(Part A) · 실사용에서 무엇이 드러났으며(Part B) · 무엇을 만들 것인가(Part C)"를 분리해 기록한다.
> 사용자 문서는 [README.md](../README.md), 에이전트 공통 규약은 [AGENTS.md](../AGENTS.md), Claude 전용 지식은 [CLAUDE.md](../CLAUDE.md)에 있다.
>
> **상태 범례** — ✅ 구현됨 · 🟡 부분(단순 프록시/유형 미분화) · ⬜ 로드맵(코드 부재)

---

## 0. 정체성과 철학

`kr-history-bm25`는 단순한 한국사 검색 라이브러리가 아니다.

핵심 목표는 **사서 원문을 데이터로 취급하여, 문헌연구를 재현 가능한 계산 실험(computational experiment)으로 만드는 것**이다.

> 결론을 가르치는 도구가 아니라, 원문 데이터가 스스로 드러내는 구조를 보여주는 도구.

동일한 코퍼스·검색 조건·알고리즘·파라미터를 쓰면 누구나 같은 검색 결과와 군집 구조를 재현할 수 있어야 한다. 도구는 특정 위치나 학설을 사실로 강제하지 않고, **강한 근거는 강하게 · 약한 근거는 약하게** 드러내 연구자의 자발적 발견을 유도한다.

기본 연구 자세는 전통적 문헌연구(`가설 → 문헌 탐색 → 근거 선별 → 논증`)를 다음으로 전환한다.

> **내 가설을 증명할 원문을 찾아라가 아니라, 동일한 조건으로 데이터를 돌렸을 때 어떤 구조가 반복해서 나타나는가를 보라.**

신뢰 근거는 언제나 **한자 원문**이다(직역·독음은 보조). 이 원칙(`trust-principle`)과 데이터 주도(`data-driven-insight`) 정신이 아래 모든 설계의 뿌리다.

---

# Part A — 현행 구현 (v0.2.1)

> v0.2.1 코드에서 실제로 동작하는 것. 각 항목에 소스 경로 근거를 단다.

## A-1. 표면 (CLI · API · MCP)

### ✅ CLI — `krh` (11개 명령, `src/cli/krh.ts`)

공통 옵션 `--db <path>`(기본 `KRH_DB` 또는 `history.sqlite`).

| 명령 | 역할 | 주요 옵션 |
|------|------|-----------|
| `ingest <dir>` | 사서 원자료 적재 | `--code`, `--name` |
| `translate` | 직역 생성(증분) | `--provider`(기본 claude), `--limit`, `--corpus` |
| `translate-export` | 직역 대상 내보내기 | `--provider`(기본 codex), `--corpus`, `--limit`, `--out` |
| `translate-import <file>` | 직역 결과 반입 | `--provider`, `--model` |
| `reading-ingest-unihan <file>` | Unihan kHangul 적재 | — |
| `reading-build` | 독음 사전 구축 | `--seeds`, `--dict` |
| `reading-export` | 독음 예외 검수 내보내기 | `--seeds`, `--out` |
| `reading-import <file>` | 독음 검수 반입 | `--seeds` |
| `search <term>` | BM25 검색 | `--index han\|ko`(기본 han), `--limit`(20) |
| `cluster <surface>` | 공기(共起) 군집 | `--type`, `--neighbor-type`, `--limit`(50) |
| `place <surface>` | 표기 출현 위치 | `--type`, `--limit`(100) |

> ⚠️ 이표기 확장(`with_variants`)은 **CLI에 미노출**이다. 현재 API·MCP로만 쓸 수 있다.

### ✅ 공개 API (`src/index.ts` 배럴, `src/history-db.ts` 파사드)

- 열기: `openBundledDb`(동봉 코퍼스), `openHistoryDb` / `HistoryDb`
- 검색: `searchHan`, `searchKo`, `lookupPlace`, `cluster`
- 이표기: `withVariants`, `expandVariants`, `addVariantGroup`
- 번역: `translateCorpus`, `exportPending`, `importResults` (+ Claude/Cloudflare/Codex provider)
- 독음: `ingestUnihan`, `buildReadings`, `synthesizeOriginal`, `deriveConventional`, `toDueum`

> 실제 심볼명은 `lookupPlace` · `withVariants`다(문서 초안이 쓰던 `place`/`variants`가 아님).

### ✅ MCP 서버 — 5 도구 + 가이드 (`src/mcp/tools.ts`, `guide.ts`)

| MCP 도구 | title | 입력 |
|----------|-------|------|
| `search_han` | 한자 원문 BM25 검색 | `term`, `limit`, `corpusCode` |
| `search_ko` | 직역(보조) BM25 검색 | `term`, `limit` |
| `lookup_place` | 표기 출현 위치 조회 | `surface`, `type`, `limit` |
| `cluster` | 공기(共起) 군집 | `surface`, `type`, `neighborType`, `limit` |
| `with_variants` | 이표기 확장 검색 | `surface`, `limit`, `corpusCode` |

가이드 prompt `toponym-identification-guide` 1개(resource는 없음): 원문 최우선 · 군집으로만 판단 · 수계 위계 코드(河/江/水/川) · **외부 지도 교차 검증**(바이두·구글 고지도·현대지도) · 천문 기록 · 확정 표현 금지.

## A-2. 데이터 계층

### ✅ 스키마 — 13 테이블 (`src/db/migrations/0001-init.ts`, `0002-reading.ts`)

`corpus` · `node`(계층 트리) · `passage`(BM25 문서 단위) · `entity` · `entity_mention` · `annotation` · `variant_group` · `variant_member` · `translation` · `passage_fts_han` · `passage_fts_ko` · `char_reading` · `entity_reading`.

### ✅ 이원 BM25 인덱스 (`dual-index`)

- **주 = `passage_fts_han`**: 한자 원문. FTS5 external content(`content='passage'`), 한자 unigram 분해 색인, 토큰화 `unicode61`, `passage` 트리거로 동기화.
- **보조 = `passage_fts_ko`**: 직역(한글). standalone FTS5, 채택 직역(`translation.adopted=1`)만 적재.
- BM25 문서 단위 = **passage**, 공기 군집 단위 = **node(기사)**.

### ✅ 직역 현황

| 사서 | 성격 | 직역 |
|------|------|------|
| 삼국사기 | 정사 | ✅ 완료 |
| 삼국유사 | 야사 | ✅ 완료 (합계 6,838건) |
| 고려사 | 정사 | ⬜ 미완 |
| 고려사절요 | 파생 | ⬜ 미완 |
| 한국고대사료집성 | 교차(중국 25사) | ⬜ 미완 |

> 사서별 완료 상태는 스키마 플래그가 아니라 데이터에만 있다. `search_ko`는 직역 완료 코퍼스에서만 유효하다.

### ✅ 독음 이중 레이어 (`reading-layer-original-first`)

`char_reading`(Unihan kHangul, 다음자 `seq`, 두음 `is_dueum`) + `entity_reading`(원음 original / 관용 conventional, 유형별 채택 1개 강제). 원음이 authoritative, 관용은 주석.

## A-3. 동봉 코퍼스

✅ `data/history.sqlite.gz` + `src/bundled-db.ts` 로더. `findDataDir()`로 탐색 → 첫 사용 시 `gunzip`, 쓰기 불가 시 OS 임시폴더 폴백. 빌드는 `scripts/build-corpus.mjs`(사서 ingest → VACUUM → gzip).

## A-4. 🟡 부분 구현 (이름은 있으나 아직 단순한 것)

- **`cluster`** 🟡 — 같은 **node(기사)** 안에 공동 출현한 개체를 공기 빈도(`COUNT(DISTINCT node_id)`)로 내림차순 반환한다. 퍼지 밀도·소속도·DBSCAN은 없다. 이것은 향후 퍼지 군집(Part C-2)의 **초기 프록시**다.
- **이표기(`variant_group`/`with_variants`)** 🟡 — 표기들을 단일 FTS `OR` 질의로 병합해 함께 검색한다. 관계유형 구분(번체/간체·이체자·명시 이명·추정 이명)은 없다(Part C-4).

## A-5. 🔴 개념명 ↔ 실제 심볼 매핑

초안·설계 논의에서 쓰던 개념명과 **실제 코드 명명이 다르다.** 이 문서와 코드를 잇는 기준표다.

| 개념명(초안) | 실제 코드 심볼 | 위치 |
|--------------|----------------|------|
| documents | `passage` | schema / 0001-init |
| documents_fts | `passage_fts_han` + `passage_fts_ko` | 0001-init |
| entities | `entity` (+ `entity_mention`) | schema |
| aliases | `variant_group` + `variant_member` | schema |
| place / lookup | `lookupPlace` / `lookup_place` | search·mcp |
| variants / expand | `withVariants` / `with_variants` | search·mcp |
| search_corpus | `search_han` (한자) / `search_ko` (직역) | mcp/tools.ts |
| embeddings | (없음 — Part C-1) | — |
| cluster_results | (없음 — Part C-2) | — |

---

# Part B — 실사용 관찰 (0.2.0 후기)

> GPT가 0.2.0/0.2.1을 실제 설치·검색해 관찰한 결과. **도구가 데이터에서 스스로 드러낸 구조**이며(`data-driven-insight`의 serendipitous discovery가 작동한 증거), 확정된 역사 결론이 아니다.
> 이 사례들은 **README 대표 사례 · 회귀 검증 픽스처** 후보다.

## B-1. 浿水 — 하나의 수계인가?

BM25·공기 분석에서 `浿水`가 단일 수계로 통합되기보다 **문맥별 분리 필요성**이 관찰됐다.

```text
A군: 위만조선·왕검성·연·요동 패수
B군: 고구리 평양성·장안성 남쪽 패수
C군: 고구리-백제 전투 패수
D군: 당-고구리 전쟁의 패강
E군: 신라 패강진·패강도·패강장성
F군: 고려 서경 대동강·패강·왕성강
```

> 연구 질문: 사서의 `浿水`는 하나의 동일 수계를 일관되게 지칭하는가?

우리가 6군을 지시하지 않았는데 사용자가 검색·공기만으로 이 질문에 도달했다 — 도구가 의도대로 "자발적 아하"를 유발했다. 자동 분리·검증은 향후 퍼지 군집·벡터 검색(Part C)의 과제다.

## B-2. 慈悲嶺 = 岊嶺 — 사서 명시 이명

원문에서 직접 동일 관계가 확인됐다.

```text
有岊嶺【卽慈悲嶺】   → 岊嶺 = 慈悲嶺 (사서 명시 이명, explicit alias)
```

> ※ 이 원문 인용의 표기 정확성은 향후 동봉 코퍼스와 대조 검증 대상.

공기 지명: 西京 · 東寧府 · 洞州 · 北界 · 鴨綠江 · 黃州 · 平州. 절령은 왕의 행차로 · 역참망 · 군사 방어선 · 정치·영토 경계로 기능해, 단순한 산이 아니라 상경권과 서경·북계권을 잇거나 가르는 **복합 교통·군사·행정 관문**으로 분석됐다.

## B-3. 大同江 — 기능적 수계 조건

강한 공기: 西京 · 平壤 · 浮碧樓 · 永明寺 · 中和郡 · 慈悲嶺 · 岊嶺. 원문에서 왕실 누선·용선 운항, 부벽루 유람, 군대 도하가 확인된다. 후보 수계의 기능 조건 = 도성 근접 + 대형 왕실 선박 운항 + 누각·사찰·궁전 연결 + 하류 항행 + 군대 도하 여울.

## B-4. 隴西 — 단독 일치의 함정

`隴西` 검색에서 **행정구역 · 인물 본관 · 시 제목 · 고려 목장명 · 동주 별호**가 혼재했다. 단독 일치만으로 지리 비정을 확정할 수 없다는 것을, 도구가 실사용에서 재현했다(`context.md` "확정 표현 금지"의 데이터적 증거). → 비정은 지명 **군집**으로 판단해야 함을 보여주는 사례.

---

# Part C — 로드맵 (미구현)

> 코드에 아직 없는 것. 각 항목에 "현행 대비 무엇이 없는가" + bd 이슈 ID. `mcp-scope` 결정상 벡터·퍼지군집은 MCP 선행조건이 아니라 **후속 보강층**이다.

## ⬜ C-1. 하이브리드 검색 — 벡터(의미) + RRF · `krh-cvh`

- **현행 부재**: 벡터·시맨틱·하이브리드·RRF 코드 0, `embeddings`(F32_BLOB) 컬럼 없음.
- **방향**: BM25(정확 문자 증거)를 **대체하지 않고** 보완. 의미 근접 기록을 벡터로 확장 → RRF로 후보 병합·재랭킹 → 채널별 근거(`bm25Rank`/`vectorRank`/`rrfScore`) 보존.
- **정합**: `libsql-vector-spec`(동봉 `.sqlite`에 F32_BLOB 컬럼 추가, `vector_distance_cos`, 추가 의존성 0). 별도 벡터 DB 설치 불필요.

## ⬜ C-2. 퍼지 밀도 군집(FDBSCAN) · `fuzzy-dbscan` / `dbscan-clustering`

- **현행 부재**: `cluster`는 공기빈도 카운트 프록시(A-4). 밀도·소속도·경계/노이즈 판별 없음.
- **방향**: 하나의 지명·기록이 여러 문맥 군집에 중첩됨(fuzzy border 소속도)을 보존. 예) `浿水` → {평양성 0.82, 왕검성 0.71, 백제전쟁 0.64, 서경수계 0.58}. 동명이의·시대별 용례 분리(隴西 사례). 밀도 = 공기 + 벡터의미 + 좌표 하이브리드에 지명 위계(河/江/水/川) 가중.
- **경계**: v0.1.0 밖. 백엔드 후보생성층. (bd 이슈 미등록 — 메모리 `fuzzy-dbscan`·`dbscan-clustering` 참조.)

## ⬜ C-3. cluster scope 3분리 · `krh-cyi` (신규)

- **현행 부재**: `cluster`는 node(기사) 단위 **고정**. B-1처럼 넓은 지리지 항목이 지명을 통째로 묶는다.
- **방향**: `ClusterOptions`에 `scope`(sentence/paragraph/article) 추가로 공기 범위 조절. 모든 결과에 원문 ID·근거 문장 유지. `dual-index`(BM25 단위=passage)와 정합.

## ⬜ C-4. 이표기 관계유형 구분 · `krh-2ol` (신규)

- **현행 부재**: `variant_group`에 자유텍스트 `note`/`source`만, 유형 미분화. 번체/간체 정규화 로직 없음.
- **방향**: 4유형 분리 —
  1. **script normalization** 번체 ↔ 간체
  2. **variant character** 이체자·구자체·속자
  3. **explicit alias** 사서 직접 명시 이명 (예: 岊嶺=慈悲嶺)
  4. **inferred alias** 연구자 추정 후보
- **원칙**: 원문 표면형 보존, **검색 정규화와 역사적 동일성 판정을 혼합 금지**, 명시 이명과 추정 이명 구분, 확장 방식을 결과에 표시. (`trust-principle` 확장. 어원 음차 매핑 `krh-bqp`와는 축이 다름.)

## ⬜ C-5. 재현성 실험 매니페스트 · `krh-btf` (신규)

- **현행 부재**: 실험 조건 고정 산출물 없음.
- **방향**: `corpus_version` · `dictionary_version` · `embedding_model` · `chunking_rule` · `search_parameters` · `clustering_params` 등을 매니페스트로 스탬프. "해석은 달라도 실험 결과는 재현." 벡터·군집(C-1/C-2) 도입 시 필드가 채워지므로 **스키마 선언 우선, 값 채움은 후속**.

## ⬜ C-6. 비정·시각화·GeoJSON · `krh-bqp` (확장)

- **현행 부재**: 네트워크 그래프·소속도 히트맵·2D 임베딩·지도·GeoJSON 출력 없음. 모든 도구는 JSON 텍스트만 반환.
- **방향**: 사서 지명 군집 ↔ 현대 공간 군집을 명칭·번체간체·공기·방위·거리·수계·행정배열·이동경로로 비교해 **구조적 일치도**를 보여준다(확정 강제 금지, 확정/후보/미비정/시대별 구분). 시각화 노드·간선은 원문 근거로 역추적 가능.
- **경계**: **본체는 GeoJSON/JSON 출력까지**, 렌더링은 별도 viewer. 본체가 렌더링을 떠안지 않는다.

## ⬜ C-7. 가이드 내부/외부 사서 교차검증 · `krh-19d`

- **현행 부재**: 가이드는 원문↔지도 교차만. 내부 사서(고려사 자기기록) vs 외부 사서(25사 관찰) 교차검증 구조 없음.
- **방향**(`cross-source-method`): [1차] 내부 기록 권역 확인 → [2차] 외부 기록 대조 → [3차] 표기차·시기차 추출 → [4차] 내·외부 공통 지지 공간관계. 산출 4분할(자기기록/외부관찰/겹침/충돌).

## ⬜ C-8. North-star (장기 비전 — bd 미등록)

- **§조선왕조실록 확장**: 실록·비변사등록·승정원일기·지리지 추가 시 간도·두만강·토문강·사군육진·봉금지대 등을 계산적으로 분석. 강역을 단일 선이 아니라 행정·군사·교역·생활·주장·분쟁 경계로 구분.
- **§도메인 독립 core 분리**: 엔진(SQLite corpus · FTS5/BM25 · 벡터/하이브리드 · 공기 · 퍼지군집 · 매니페스트 · MCP)을 한국사 코퍼스층과 분리해 타 문헌(법학·의학·특허·종교학 등)에 재사용.
- **경계**: 코어 분리는 **벡터·FDBSCAN 안정화 이후**. 지금 추상화하면 인터페이스를 두 번 부순다(조기 추상화 경계).

---

## 개발 원칙 (불변식)

Claude(및 모든 에이전트)가 이 프로젝트를 개발할 때 우선하는 규율. bd 메모리 키를 병기한다.

1. 원문 데이터를 현대적 해석으로 덮어쓰지 않는다. (`trust-principle`)
2. 검색 정규화와 원문 보존을 분리한다.
3. 번체·간체 변환과 역사적 이명 관계를 분리한다. (C-4)
4. 사서 명시 관계와 연구자 추정 관계를 분리한다.
5. 모든 분석 결과는 원문 ID·근거로 역추적 가능해야 한다.
6. BM25와 벡터의 역할을 혼합하지 않고 채널별 근거를 보존한다. (`dual-index`)
7. 퍼지 군집 결과는 확정 사실이 아니라 데이터가 발견한 구조로 표현한다.
8. 실험 조건·버전을 보존해 결과를 재현 가능하게 한다. (C-5)
9. 특정 학설을 증명하도록 알고리즘을 설계하지 않는다. (`data-driven-insight`)
10. 별도 인프라 설치 없이 바로 쓰는 로컬 우선 구조를 유지한다. (`driver-libsql`)
11. 코퍼스·검색·군집·사전·MCP를 가능한 한 모듈화한다.
12. 기능 추가 시 기존 CLI·MCP 사용 경험의 단순성을 훼손하지 않는다.
13. 근거 우선 — 독음·직역은 검증 가능한 사전을 먼저 확보한 뒤 착수, LLM은 예외 검수로 한정. (`evidence-first-guard`)

---

## 최종 제품 정의

> 사서 원문을 기반으로 정확 검색 · 의미 검색 · 공기 관계 · 퍼지 밀도 군집 · 문자 체계 매핑 · 교차검증을 수행하고, 모든 결과를 원문으로 역추적할 수 있게 하는 **재현 가능한 계산 문헌연구 프레임워크**.

더 짧게: **문헌연구를 재현 가능한 데이터 실험으로 전환하는 연구 도구.**

가장 중요한 원칙:

> **내 가설을 증명할 원문을 찾아라가 아니라, 동일한 조건으로 데이터를 돌렸을 때 어떤 구조가 반복해서 나타나는가를 보라.**
