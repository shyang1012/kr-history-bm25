# FDBSCAN MVP — 공기 기반 퍼지 밀도 지명 군집 (krh-zij)

## Context (왜)

`kr-history-bm25`는 검색·독음·간자체·비정 가이드까지 갖춘 뒤(0.3.1), 다음 분석층으로 **FDBSCAN(퍼지 밀도 군집)** 을 향한다(PM 2026-07-11). 현 `cluster()`는 "단일 지명 → 공기 이웃 카운트" 프록시일 뿐, **밀도·소속도·경계/노이즈 판별이 없다**(framework.md:111,190).

**목표(MVP)**: 하드 DBSCAN을 퍼지화한 **비즈니스 로직(코어 알고리즘)** 을 **공기(co-occurrence) 특징공간만으로** 구현한다. 하이브리드(벡터·좌표)는 **후속**(PM: "비즈니스 로직부터 → 하이브리드 나중"). 핵심 산출 = **fuzzy border 소속도**(한 지명이 여러 군집에 `A 0.7 / B 0.3`) — 이는 context.md "고신뢰 비정 **가능성** 등급"과 문자 그대로 일치해, 도구의 "확정 금지·발견 보조" 철학에 가장 충실하다. 방금 낙랑 공기망(遼東·碣石·幽州권)이 이 알고리즘의 실검증 대상.

설계 근거: 메모리 `fuzzy-dbscan`·`dbscan-clustering`, 문헌선행 Ienco&Bordogna·FN-DBSCAN. 결정론적(재현성, FCM 랜덤초기화 없음).

## 범위 경계

- **IN(MVP)**: 공기-유사도 특징공간 + FDBSCAN 코어(퍼지 밀도 + fuzzy border 소속도) + seed 중심 ego-network 군집 + 파사드/CLI/MCP 노출 + 테스트.
- **OUT(후속)**: 벡터 의미층(krh-cvh), 좌표층(krh-bqp), meta-rules 위계가중(河/江/水/川), 전역(전 지명) 군집. 코어는 이들을 받도록 확장 가능하게 설계하되 이번엔 미배선.
- **소프트 품질지표 유예**: `fuzzy-dbscan` 메모리의 검증 프로토콜(Xie-Beni·소프트 실루엣·고지도 일치)은 **하이브리드(벡터·좌표) 단계와 함께** 착수한다. MVP(공기만)는 결정론성·경계 소속도·낙랑 실검증으로 1차 타당성만 확인(소프트지표는 특징공간이 풍부해진 뒤라야 의미).

## 알고리즘 (순수 TS, 결정론적)

**1) 유사도(공기 → Jaccard).** 지명 A,B의 공기 유사도:
`sim(A,B) = cooc(A,B) / (deg(A) + deg(B) − cooc(A,B))` (Jaccard, [0,1]).
`cooc(A,B)`=A·B가 함께 등장한 DISTINCT unit(node 또는 passage) 수, `deg(X)`=X가 등장한 DISTINCT unit 수. 알고리즘은 `sim`을 직접 쓴다(거리 변환 불요).

**2) 퍼지 밀도(soft neighborhood).** 하드 eps·MinPts 대신 **가중 밀도**:
`ρ(p) = Σ_{q: sim(p,q) ≥ simMin} sim(p,q)` — 이웃 유사도 합(soft count). eps 민감도 완화(fuzzy-dbscan 축②).

**3) 코어/군집.** `ρ(p) ≥ muMin` → 코어. 코어끼리 `sim ≥ simMin`이면 같은 군집(연결요소). 자동 군집수·노이즈 처리(DBSCAN 유지).

**4) fuzzy border 소속도(축①, 핵심 신규).** 비코어 점 q의 군집 C 소속도:
`m(q,C) = Σ_{core p∈C} sim(q,p) / Σ_{C'} Σ_{core p∈C'} sim(q,p)` — 여러 군집에 걸친 경계 지명(이동·동음이의)을 소속도로 보존(예 浿水→{평양성 0.82, 왕검성 0.71} 정규화). 코어 연결 없고 ρ 낮으면 노이즈.

**불변식(결정론 계약, F-03).**
- `ρ(p)` 합산은 **self 제외**(q≠p). `sim`은 유한 `[0,1]`.
- **고립점**(이웃 없음)·**분모 0**(코어 연결 없음) → **노이즈**(membership 생성 안 함, 코어 안 됨).
- **코어 점 membership=1**(자기 군집). border membership 합 = 1(허용오차 내).
- `clusterId` = 군집 내 **최소 canonical key(정렬된 entity_id/surface)** 로 결정. 모든 반환 배열·SQL은 **tie-break 정렬**(surface·entity_id)로 순회 순서 무관하게 동일 출력.
- 엣지케이스(대칭 경계·전부 노이즈·단일 군집·고립점·분모 0)는 각각 테스트로 고정.

**결과 계약: seed-induced local graph(F-01).** MVP의 ρ·코어·소속도는 **seed 유도 국소 그래프 U 내부에서만** 계산된다(전역 밀도 아님). U = seed + seed 공기 지명(`cooc DESC, entity_id ASC` 정렬, `limit` 절단). 반환에 `truncated`(절단 여부)·`unitScope`·`params`를 포함하고, CLI/MCP 설명에 "국소 분석, 전역 군집 아님"을 명시. 전역 확장은 후속(코어는 generic이라 전 지명 입력도 가능).

**파라미터(sweep로 확정, F-02)**: `scope`(article=node_id/paragraph=passage_id), `simMin`(soft eps), `muMin`(코어 밀도), `minCooc`(엣지 컷), `limit`(U 상한). 🔴 **기본값은 실데이터 sweep 게이트 통과 후 확정**(아래 구현 0단계) — 임의 고정 금지. 잠정 시작값 simMin=0.08/muMin=0.3/minCooc=2/limit=200이나 sweep로 조정.

## 구현 (TDD, cluster 패턴 답습)

> 🔴 아래 표의 번호는 **참조용 빌드 목록(bottom-up)** 이지 실행 순서가 아니다. TDD 준수 — 각 단위(코어·place-clusters)는 **테스트를 먼저** 쓰고 구현한다(AGENTS.md "TDD + e2e").

| # | 파일 | 내용 |
|---|---|---|
| 1 | `src/search/fdbscan.ts`(신규) | 순수 코어 `fdbscan(points, simFn, params)` → `{clusters, memberships, noise}`. 밀도·코어·연결요소·소속도. 특징공간 무관(재사용). |
| 2 | `src/search/place-clusters.ts`(신규) | seed 중심 노출 함수 `placeClusters(client, surface, options)`: ①ego-network SQL(seed + 공기 지명 + 상호 pairwise 공기·deg) ②Jaccard sim ③`fdbscan` 호출 ④결과 매핑(간체 병기 `toSimplified` 재사용). |
| 3 | `src/types.ts` | 신규 타입: `FuzzyMember{surface,membership,simplified?}`, `FuzzyCluster{clusterId,members,core}`, `PlaceClusterResult{seed,scope,clusters,noise}`. |
| 4 | `src/history-db.ts` | 파사드 `placeClusters()` 얇은 위임(cluster 옆). |
| 5 | `src/index.ts` | 배럴 export(함수·타입). |
| 6 | `src/cli/krh.ts` | `place-clusters <surface>` 커맨드(--scope/--sim-min/--mu-min/--limit). 출력: 군집별 지명(소속도·간체 병기). |
| 7 | `src/mcp/tools.ts`·`create-server.ts` | MCP 도구 `place_clusters`(7번째). 설명에 "소속도=비정 가능성, 확정 아님" 인코딩. |
| 8 | `tests/fdbscan.test.ts`(신규) | 코어 단위(작은 sim 그래프→기지 군집·경계 소속도·노이즈·결정론성). place-clusters :memory:(search.test.ts 픽스처 `tests/fixtures/corpus`) + 동봉 e2e(`placeClusters('樂浪')`→군집>0, 경계 지명 분할 소속도). |

**0단계 — 파라미터 sweep 게이트(F-02, 구현 첫 스텝).** `scripts/fdbscan-sweep.mjs`(신규)로 동봉 DB에서 `(scope, minCooc, simMin, muMin, limit)` 조합 × 대표 seed(樂浪·浿水·平壤 등)를 돌려 **코어 수·최대 군집 비율·노이즈율·군집 수**를 기록(`tmp/fdbscan-sweep.json`). 병리(전부 한 군집/전부 노이즈) 없는 범위에서 기본값 확정 후에만 코드에 고정. 재현성 매니페스트(krh-btf 정합)에 파라미터·코퍼스 해시 기록.

**단일 옵션 계약(F-04)** — 6표면 동일:
| 옵션 | 타입 | 파사드/코어 | CLI | MCP |
|---|---|---|---|---|
| `scope` | article\|paragraph | ✓ | `--scope` | zod enum |
| `simMin` | number | ✓ | `--sim-min` | number |
| `muMin` | number | ✓ | `--mu-min` | number |
| `minCooc` | int | ✓ | `--min-cooc` | int |
| `limit` | int | ✓ | `--limit` | int |

CLI에 **`--min-cooc` 포함**(F-04 지적), MCP `inputSchema`·`McpCorpus` 인터페이스(create-server.ts:31-38)·단위 스텁(tools.test.ts:15)에 `placeClusters` 추가. 반환 `params`에 실제 적용값 병기.

**공기 ego-network SQL(dedup-first, F-05)** — cluster.ts `SCOPE_UNIT_COLUMN` 화이트리스트(17-20)로만 scope 반영(injection-safe):
```sql
-- 1) place_units: 같은 (unit, 지명 entity) 중복 mention 제거(조인 폭발 방지)
WITH place_units AS (
  SELECT DISTINCT m.<unit> AS unit, m.entity_id
    FROM entity_mention m JOIN entity e ON e.id=m.entity_id AND e.type='지명'
)
-- 2) U: seed와 공기하는 지명(+seed), cooc DESC·entity_id ASC 정렬 후 limit 절단
-- 3) U 내부 pairwise: place_units self-join ON 같은 unit, a.entity_id<b.entity_id,
--    COUNT(DISTINCT unit)=cooc, HAVING cooc>=minCooc
-- 4) deg(X)=SELECT COUNT(*) FROM place_units WHERE entity_id=X (이미 DISTINCT unit)
```
🔴 seed→U 제한 후 U 내부만 self-join(전역 455k쌍 매요청 반복 금지). `EXPLAIN QUERY PLAN`·행수·시간 상한을 검증 항목에 포함.

## 검증 (end-to-end)

0. **sweep 게이트 통과**(F-02) — 기본 파라미터가 병리 없는 범위임을 `tmp/fdbscan-sweep.json`으로 확인 후에만 고정.
1. **품질 게이트**: `npm run validate`(선제 `npm run format`으로 CI format:check 예방 — ci-format-crlf-gotcha).
2. **코어 단위 테스트(불변식 중심, F-03·F-06)**: 손으로 만든 sim 그래프로 — ①2군집+경계점 분할 소속도(합=1) ②노이즈 분리 ③고립점→노이즈 ④분모0→노이즈(코어 안 됨) ⑤단일군집 ⑥대칭 경계 ⑦**동일 입력 동일 출력**(clusterId·배열 정렬 결정론). 옵션 전달 검증.
3. **라이브러리 e2e(구조 불변식, F-06)**: `openBundledDb()` → `placeClusters('樂浪',{scope:'article'})` → **비어있지 않음·정렬·`truncated` 필드·membership 합≈1·params 반영** 같은 **구조 계약**을 단언. 樂浪의 특정 군집 수·경계점은 **보정 매니페스트로 고정한 값에 한해** 단언(데이터 변동에 취약한 하드코딩 금지).
4. **CLI e2e**: `krh place-clusters 樂浪` 서브프로세스 stdout에 군집·소속도·간체 병기(구조 확인).
5. **MCP e2e**: server e2e에서 `place_clusters` 호출 계약 검증. **도구 수 6→7** 단언 갱신(tools.test.ts:88-97, server.e2e.test.ts).
6. **SQL 성능(F-05)**: 동봉 DB에서 seed ego-network 쿼리 `EXPLAIN QUERY PLAN`·반환 행수·시간 상한 확인(전역 pair 반복 없음). 낙랑 U(수백 지명) in-memory 즉시. 전역은 범위 밖.

## 커밋·이관

- 브랜치 `dev`(main 직접 금지). CW-AP-D03 헤더·서명 `shyang`. TDD.
- bd: `krh-zij` claim/진행, 완료 시 close. 실사용 결과(낙랑 퍼지 군집)를 `discovery-nakrang-cluster`에 보강. 배포는 별도(`/배포`, 0.4.0 minor 후보 — PM 결정).
- 계획서 저장소 `.claude/plans/`로 이관.

## 미결·확인 필요

- **노출 형태**: seed 중심 `placeClusters(surface)`(권장·MVP, 해석적·bounded) vs 전역 전-지명 군집. → 권장 seed 중심(코어는 전역도 지원하도록 generic).
- **파라미터 기본값**: 5개(scope·simMin·muMin·minCooc·limit) 모두 **0단계 sweep 게이트**로 확정 후 코드 고정(즉흥 조정 금지). sweep 결과·코퍼스 해시를 매니페스트에 기록(krh-btf 정합).
- **"6표면"** = ①fdbscan 코어 ②place-clusters 파사드함수 ③types ④history-db 파사드 ⑤CLI ⑥MCP. 위 옵션표는 이 중 옵션이 전달되는 코어/CLI/MCP 3면만 열로 표기.
