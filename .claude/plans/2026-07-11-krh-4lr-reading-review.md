# krh-4lr 검수 판정 + 검색 한글(한자) 병기 계획

## Context (왜)

승현님 지시 두 갈래:
1. **krh-4lr 진행** — "LLM char 검수 1054개 판정(원음 본음 확정)".
2. **검색 시 한글(한자) 표시 확인** — 구현 안 됐으면 **구현 계획 수립**.
3. (파생) **간자체↔정자 매핑**(krh-cgh, 방금 등록)이 후속으로 필요.

**실측으로 드러난 사실(스크래치패드 비파괴 검증):**
- 현재 `data/history.sqlite`는 `char_reading`·`entity_reading` **0행** — Unihan 미적재, 독음 사전이 어느 DB에도 안 구워짐(krh-evf 기록과 일치). 동봉 `data/history.sqlite.gz`엔 테이블 자체가 없음.
- Unihan `kHangul` 적재 후 실제 검수 큐 = **1054 = 다음자(polyphone) 118 + 희귀자(rare) 936**. 원음 확정 85.6%(53,417/62,421), has_variant 4,967.
- 936 희귀자 중 750개가 CJK 기본면인데 **대부분 간자체/이체자**(`两`兩 `个`個 `义`義 `刘`劉 `别`別 `内`內 `况`況 …) → per-char LLM 추측이 아니라 **Unihan 변이 필드 근거로 정자 독음 상속**이 정답(= krh-cgh).
- **검색 한글(한자) 병기·독음→한자 확장은 전부 미구현**(krh-6x3): `searchByReading` 없음, `entity_reading`을 읽는 쿼리가 코드에 전무, CLI/MCP/타입에 reading 필드 없음. 설계문서(`2026-07-10-krh-cun-reading-dict.md:62`)가 병기 표시를 명시적으로 "다음 Plan" 유예.

**승현님 확정 방침(krh-4lr 범위):**
> 1054개 전체를 먼저 Unihan 변이 필드로 **기계 분류**한다. 간자체·이체자로 근거 확인된 문자는 **krh-cgh 대상으로 기록하고 LLM 판정에서 제외**한다. 변이 매핑으로 해소되지 않는 **잔여 문자만 LLM 검수**한다. krh-cgh 전체 검색 기능 구현은 선행하지 않는다. krh-4lr은 1054개 전부가 **'원음 확정 / 변이 근거로 이관 / 미해결'** 중 하나로 추적된 뒤 완료한다.

원칙: `evidence-first-guard`(근거 없는 LLM 병기·독음 금지, LLM=예외 검수), `reading-layer-original-first`(원음 1차/관용 주석).

---

## Part 1 — krh-4lr 실행 (구현 대상)

### 데이터 선행: Unihan 변이 데이터 확보
- 현재 `source/unihan/`엔 `Unihan_Readings.txt`만 있음. **`Unihan_Variants.txt` 필요**(공개 UCD, `Unihan.zip` 내 포함, 읽기 전용 다운로드). `source/unihan/`에 배치(git 제외 폴더).
  - 필드: `kSimplifiedVariant`·`kTraditionalVariant`·`kSemanticVariant`·`kZVariant`.
- ⚠️ 인터넷 다운로드 단계 — 실행 시 승현님 확인 후 진행(또는 승현님이 직접 파일 제공).

### 신규 코드 (TDD, `tests/` 먼저)
| 파일 | 역할 | 답습 |
|---|---|---|
| `src/reading/variant-source.ts`(신규) | `Unihan_Variants.txt` 파싱 → `char → 변이대상 char[]` 맵 | `ingest-unihan.ts` 파서 |
| `src/reading/variant-classify.ts`(신규) | 순수함수: 검수 char + 변이맵(관계타입·방향 보존) + char_reading → `{ resolvedByVariant: {char, via, viaField, reading}[], residual: char[] }`. **이관 조건(F-02): 변이대상이 (a) 단일 확정 본음(seed/llm 또는 비두음 후보 정확히 1개)을 가질 때만 그 독음 상속.** 대상이 다독음·미확정·순환·self-link면 이관 불가 → residual. `viaField`=Unihan 필드명 근거 | `synthesize.ts` 순수함수 스타일 |
| `scripts/classify-review-chars.mjs`(신규) | 오케스트레이션: `reading-export` 산출 + variant-source + char_reading 조회 → 3버킷 매니페스트 + LLM 검수용 잔여 export JSON 생성 | `build-readings.mjs` |
| `tests/reading-variant.test.ts`(신규) | variant-source 파싱 + variant-classify 분류 왕복(`:memory:`). **엣지케이스(F-02): 다대다·양방향·순환·대상 다독음·self-link → residual로 귀결 검증** | `reading.test.ts`/`batch.test.ts` |

- 검색 통합(searchHan 정규화)은 **이번 범위 밖**(PM: krh-cgh 전체 구현 선행 금지). 변이 데이터는 분류·이관 기록에만 사용.

### 실행 파이프라인 (**work-copy 격리** — F-04)
🔴 원본 `data/history.sqlite`를 직접 갱신하지 않는다. **work-copy** `data/history.reading.sqlite`(git 제외)에서 전 파이프라인 실행 → 무결성·매니페스트·스팟체크 통과 시에만 **원자 교체**로 원본 대체. 실패 시 work-copy만 폐기(원본 무손상).

0. `cp -f data/history.sqlite data/history.reading.sqlite` — work-copy 생성. **원본 `base_db_sha` 기록**(교체 직전 재확인용). run_id 발급.
1. `krh reading-ingest-unihan source/unihan/Unihan_Readings.txt --db data/history.reading.sqlite` — char_reading 적재.
2. **build 명령 계약(F-07)**: 두 build 단계는 **동일한 seeds·dict 파일목록**을 쓴다. 디렉터리→파일목록 전개는 `build-readings.mjs`(KRH_DB=work-copy 명시) 경유. `KRH_DB=data/history.reading.sqlite … node scripts/build-readings.mjs` — 원음·관용 채택, 검수 큐 1054 산출. (⚠️ CLI `reading-build --dict`는 쉼표구분 파일경로만 받으므로 디렉터리는 스크립트 경유.)
3. `node scripts/classify-review-chars.mjs --db data/history.reading.sqlite`(**--db 필수·F-07**, 미지정 시 KRH_DB 기본=원본을 건드림) — **입력 계약(F-05): `krh reading-export`(work-copy) 산출 `chars` 배열을 유일한 기준 집합으로 고정**(input_sha·count 매니페스트 기록). 1054를 canonical 매니페스트로 3분류:
   - **변이 근거 이관** → `data/reading-variant-migrate.json`(krh-cgh 입력, `{char, via, viaField, reading}` — Unihan 필드명·근거 코드포인트 포함).
   - **잔여(LLM 검수 대상)** → `tmp/reading-review-residual.json`(주로 118 다음자).
   - **미해결 후보**(변이·독음 근거 모두 없음).
   - ⛔ **정합 가드**: 3버킷 합계 == 1054(export count) 단언. 불일치 시 중단 + 수동 점검, 진행 금지.
4. **LLM 검수(메인 에이전트=Claude)** — 잔여(`tmp/reading-review-residual.json`)의 **원음 본음(비두음 base) 확정**. 옥편 근거로 `tmp/reading-review-results.json`(`{char, reading, status:'verified'|'failed', note}`, residual과 char 집합 동일) 작성. 근거 불충분 char는 `failed`(환각 금지 → 미해결). **F-03: 이 results의 `note`·verdict를 동일 run_id로 canonical 매니페스트 `llm` 블록에 영속 보존**(char_reading엔 source='llm'만 남으므로). 예: `不→불`(본음, 부=연성변이), `金→금`(본음, 김=관용), `說→설`, `北→북`, `車→거/차`(성씨 맥락), `邯→한`(시드 기확정).
5. `krh reading-import tmp/reading-review-results.json --db data/history.reading.sqlite` — verified를 char_reading(source='llm', seq=-1) 확정. **LLM 결과→매니페스트 갱신→DB import를 동일 run_id 파생물로 고정**(F-06).
6. `KRH_DB=data/history.reading.sqlite … node scripts/build-readings.mjs`(Step 2와 동일 seeds·dict) **재실행** — 확정 본음을 surface 원음/관용에 전파.
7. **완료 검증(F-01·F-06)** — canonical 매니페스트로 1054 각 char가 `{원음확정 | 변이이관 | 미해결}` 중 **정확히 하나**임을 검증(유일성·완전성 합계==1054·상호배타성). **매니페스트↔DB 정합**: 원음확정 char가 char_reading(source='llm')에 실재, 변이이관 char는 미적재(이관만) 확인. `input_sha`==reading-export chars, **Step2·Step6 build가 동일 seeds·dict 파일목록 사용(dict_files_sha 매니페스트 기록·대조)**, 매니페스트 `llm` 블록==results.json(run_id 일치). `PRAGMA integrity_check` + 스팟체크. `work_db_sha` 기록.
8. **원자 교체(F-08)** — 검증 전부 통과 후: (a) 모든 DB 연결 종료 + WAL 체크포인트(sidecar `-wal`/`-shm` 잔존 없음 확인), (b) **`base_db_sha` 재확인**(Step 0 이후 원본 미변경 — 변경 시 중단), (c) 동일 볼륨에서 `mv -f data/history.reading.sqlite data/history.sqlite`. 실패 시 work-copy 폐기, 원본 무손상. (로컬 단일 빌드라 분산 lock 불요 — 연결종료+SHA재확인으로 충분.)

### Canonical 매니페스트 스키마 (F-01·F-03·F-05 — `data/reading-review-manifest.json`, git 포함=감사자산)
```
{
  "source": { "run_id": "...", "export_count": 1054, "input_sha": "<reading-export chars 해시>",
              "base_db_sha": "<원본 Step0>", "work_db_sha": "<검증시 Step7>", "created_at": "..." },
  "chars": [
    { "char": "两", "initial_reason": "rare|polyphone",
      "final_status": "원음확정|변이이관|미해결",
      "variant_evidence": { "via": "兩", "viaField": "kTraditionalVariant", "reading": "량" } | null,
      "llm": { "reading": "불", "note": "옥편 근거…", "verdict": "verified|failed" } | null,
      "timestamp": "..." }
  ]
}
```
- **완료 불변식**: 모든 char는 final_status 정확히 1개. 변이이관=variant_evidence 필수, 원음확정=llm.verified 또는 seed 근거, 미해결=근거 없음(llm.failed 또는 무판정). Step 7이 이 불변식을 검증.

### 이관·기록
- `data/reading-variant-migrate.json`을 **krh-cgh에 첨부**(bd note) — 간자체 매핑의 구체 입력(필드명·근거 포함).
- 필요 시 반복 확정 본음을 `data/reading-seeds.json`(권위 시드, git 포함)에 승격.

### 범위 경계 + 변경 gate (F-05)
- **허용 변경(Part 1)**: `src/reading/variant-*.ts`, `scripts/classify-review-chars.mjs`, `tests/reading-variant.test.ts`, work-copy DB, `data/reading-*.json`(매니페스트·이관·시드), 파사드/CLI에 **분류·검수 노출만**(필요 시).
- ⛔ **금지(Part 2 침범 방지 diff gate)**: `src/search/*`, `src/types.ts`, `src/mcp/*`, 검색 CLI 분기 변경 금지. 커밋 전 diff가 이 경계를 넘지 않는지 확인.
- work-copy에서만 작업, 검증 후 원자 교체. **동봉 `.gz` 재압축·배포는 krh-evf(릴리스)** — 본 계획 밖.
- krh-4lr 완료 = canonical 매니페스트 3-상태 불변식 충족. krh-cun 진행 갱신.

---

## Part 2 — 검색 한글(한자) 병기 (구현 계획서 · 이번엔 코드 미착수)

승현님 지시: "안되면 계획을 세우고" → **설계만 제시, 구현은 별도 승인 세션**. 기존 bd `krh-6x3` 스펙 구체화.

### 표현 규약 (PM 2026-07-11 — CLI/MCP 라벨)
`reading_type='original'` 내부 필드는 유지하되, **사용자-facing 라벨은 "원음"이 아니라 "대표음(표준 한자음/사전 표제음)"**. 이유: original은 음운사 원형 주장이 아니라 **추적성 기준 대표키**(사전에서 `金→금` 표준 경로 유지)라 "원음"이 오해를 부름. 음가 이력을 4층으로 노출:
```
대표음(사전 표제음):  금   ← reading_type=original (검색·사전 연결 대표키)
관용/성씨 독음:       김   ← reading_type=conventional
역사 재구음:         *kim  ← 주석 레이어(후속, krh 어원주석 이슈)
현대 중국어:         jīn   ← 주석 레이어(후속)
```
CLI/MCP 반환·출력 라벨은 `대표음`/`관용` 사용. 내부 필드명 `original`은 후속에서 `dictionary_reading` 등으로 리네이밍 검토.

### 목표 두 축
1. **입력(독음→한자 확장)**: `searchByReading('강감찬')` → `entity_reading`(대표음/관용 매칭) → entity surfaces(+`expandVariants`) → `searchHanByMatch` 병합.
2. **출력(병기)**: 결과에 `대표음(한자)〔관용 X〕` 병기. `has_variant`(대표음≠관용)이면 관용 주석 표시.

### 설계 (구현 시)
| 계층 | 신규/수정 | 내용 |
|---|---|---|
| 선행 데이터 | krh-evf | 동봉 DB에 `entity_reading` 베이킹(없으면 확장 무의미) |
| API | `src/search/search-by-reading.ts`(신규) | 독음→entity_reading→surfaces→`searchHanByMatch`(variants.ts `expandVariants` 재사용). 반환 `{query, surfaces, readings:{original,conventional}, hits}` |
| 타입 | `src/types.ts` | `ReadingSearchResult` 추가. `SearchHit`에 매칭 surface 병기용 옵션 필드 검토 |
| 조회 헬퍼 | `src/reading/reading-store.ts` | `entity_reading` **읽기** 함수(`lookupByReading`, `readingsOf(entityId)`) 신규 — 현재 쓰기 전용 |
| 파사드 | `src/history-db.ts` | `searchByReading()` 노출 |
| CLI | `src/cli/krh.ts` | `search --index reading` 분기 + 결과 `독음(한자)` 병기 출력 |
| MCP | `src/mcp/tools.ts`·`create-server.ts` | `search_by_reading` 도구 추가(LLM-facing 계약). **반환 독음 객체에 의미 필드 병기**(코덱스 제안 수용): `{reading, readingType, displayRole('dictionary_headword'\|'conventional_reading'), label('대표음(사전 표제음)'\|'관용 독음'), source(synth\|dict\|llm\|seed), confidence}`. 🔴 displayRole·label은 **표시 어댑터에서 readingType로 파생**(DB 컬럼 추가 X), provenance는 기존 `source`/`confidence`/`status` 노출 — 근거 데이터↔해석 층 분리 유지(trust-principle). 연구자가 '사전 채택 검색 기준값 ≠ 프로젝트 역사 해석'임을 인지 |
| 표시 | place/cluster 출력 | surface에 `원음(한자)` 병기(reading 조회 join) |
| 테스트 | `tests/search-by-reading.test.ts` + e2e | `강감찬`→`姜邯贊` 매칭, 병기 반환 계약, MCP 도구 왕복 |

- 스팟체크 기대(설계문서 성공기준): `강한찬`/`강감찬`→surfaces `['姜邯贊',…]`, readings `{original:'강한찬', conventional:'강감찬'}`, hits>0.
- krh-cgh(간자체 정규화)는 이 검색 입력 정규화 지점에 나중에 합류(형제 레이어).

---

## 검증 (Part 1)

1. **품질 게이트**: `npm run validate` (lint+format:check+tsc+vitest) 통과.
2. **신규 테스트**: `tests/reading-variant.test.ts` green (변이 파싱·분류 왕복).
3. **완료 불변식 검증**: canonical 매니페스트 유일성·완전성(합계==1054)·상호배타성 + `input_sha`가 reading-export chars와 일치. 이관 N / 잔여 N / 미해결 K 리포트(silent 누락 0).
4. **스팟체크 SQL**(work-copy 대상, failed 포함 left-join):
   `SELECT e.surface, r.reading_type, r.reading, r.source, r.status FROM entity e LEFT JOIN entity_reading r ON r.entity_id=e.id AND r.adopted=1 WHERE e.surface IN ('姜邯贊','高麗','鄭麟趾','金庾信') ORDER BY e.surface, r.reading_type;`
   기대: 姜邯贊→강한찬/강감찬, 高麗→고리/고려, 鄭麟趾→정린지/정인지, 金庾信→금유신/김유신.
5. **무결성·e2e**: work-copy `PRAGMA integrity_check` OK + `openHistoryDb('data/history.reading.sqlite')`로 확정 char 전파 확인. **통과 후에만 원자 교체**(Step 8).

## 커밋·이관
- 브랜치 `dev`(main 직접 금지). CW-AP-D03 헤더·서명 `shyang`.
- bd: `krh-4lr` close(3-상태 추적 달성 시), `krh-cgh`에 이관 리스트 첨부, `krh-cun` 진행 갱신, 필요 memory(`bd remember`) 기록.
- 계획서 `.claude/plans/`로 이관.

## 미결·확인 필요
- **Unihan_Variants.txt 취득 방식**: 실행 시 인터넷 다운로드(공개 UCD) vs 승현님 직접 제공 — 실행 직전 확인.
- Part 2는 **계획만**. 구현 착수는 별도 승인.
