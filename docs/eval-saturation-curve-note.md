# 검색 포화곡선(Saturation Curve) 기반 최적 검색 깊이 — 아이디어 평가 노트

> 상태: **평가 노트(REVIEW)** · 2026-07-22 · 서명 shyang
> 대상: PM(승현님) 아이디어를 GPT가 정리한 초안에 대한 PL 기술 평가.
> 정합: 기존 [`krh-cvh-phase0-eval-report.md`](./krh-cvh-phase0-eval-report.md)(Recall@k·MRR·nDCG 오프라인 평가)와 `krh-btf`(재현성 매니페스트) 위에 얹는다.

---

## 0. 한 줄 판정

**타당하다. 단 "새 지표"가 아니라 "운영점(operating point) 결정 절차"로 재정의해야 하고, GPT 초안의 용어 오류 1건과 오프라인·온라인 혼동 1건을 교정해야 한다.**

아이디어의 진짜 가치는 "Hit@k를 반대로 계산"이 아니라 **"어디까지 검색해야 충분한가"를 한계증가량(marginal gain)의 조기 종료(early stopping)로 정하는 운영 관점**에 있다. 이 프레임은 이 프로젝트의 이원 인덱스 진단 도구로 곧장 쓸모가 있다.

---

## 1. 아이디어 정식화(요약)

검색 깊이 `k`를 1→K로 늘리며 성능 곡선을 관찰하고, 한계증가량이 임계치 이하로 `p`회 연속이면 멈춘다.

```
Δ_k      = Metric@k − Metric@(k−1)          # Metric = Hit@k 또는 Recall@k
k*       = min{ k : Δ_k < ε 가 p회 연속 }    # 권장 검색 깊이(운영점)
```

- `ε`(min_delta): 최소 유의 개선 폭
- `p`(patience): 개선 없이 더 볼 구간 수
- `max_k`: 최대 깊이(예 100), `target`: 목표 Recall(도달 시 즉시 종료)

---

## 2. 타당한 점(인정)

1. **운영점 결정 프레임이 실용적이다.** "주어진 top-k에서 성능이 얼마인가"(기존)를 "목표 성능에 top-k가 어디까지 필요한가"로 뒤집은 건 RAG 운영(리랭킹 비용·컨텍스트 길이·지연)에 직접 닿는 질문이다. `Recall–Cost AUC`로 비용축을 결합하는 발상도 옳다.

2. **조기 종료 유비가 성립한다.** Hit@k·Recall@k는 `k`에 대해 단조 비감소(monotone non-decreasing)라 `Δ_k ≥ 0`이 보장된다. 곡선이 우상향 후 평탄해지는 형태가 확실하므로 "포화점" 개념이 수학적으로 잘 정의된다. 작은 질의셋에서 `Δ_k`가 계단식으로 튀는 잡음(noise)을 `patience`로 흡수하는 설계도 타당하다.

3. **지표 분리 지적이 정확하다.** GPT가 Hit@k(정답 1개 이상 포함=Success@k) / Recall@k(관련 문서 회수율) / 곡선 요약(AUC@K)을 구분한 건 맞다. 정답이 하나면 Hit@k는 0→1 한 번만 바뀌고, 여럿이면 Recall@k 곡선이 적합하다는 판단도 옳다.

---

## 3. 교정할 점(비판)

### 3-1. 🔴 용어 오류 — "First Relevant Rank를 평균화하면 MRR"은 틀렸다

- **MRR**(Mean Reciprocal Rank)은 최초 정답 순위의 **역수**를 평균한 값이다: `MRR = (1/|Q|) Σ 1/rank_q`.
- 최초 정답 순위 자체를 산술평균한 값은 **MFRR**(Mean First Relevant Rank)로, MRR과 다른 지표다. 역수를 취하는 MRR은 상위 순위에 큰 가중을 주고 범위가 (0,1]로 유계라 꼬리 순위에 둔감하다. 반대로 MFRR은 "평균적으로 몇 위에서 처음 맞는가"라 직관적이지만 이상치(정답이 90위)에 크게 흔들린다.
- 두 값은 목적이 다르다. **순위 품질 비교=MRR, "평균 몇 개 검색해야 하나" 서술=MFRR 또는 Median First-Hit Rank**. 초안처럼 동일시하면 안 된다.

### 3-2. 🔴 오프라인 평가와 온라인 운영을 뭉갰다 — 이게 핵심 함정

초안은 `Δ_k < ε` 조기 종료를 "질의별 동적 top-k"로 확장하는데, 여기 심각한 구분 누락이 있다.

- `Δ_k`를 계산하려면 `Metric@k`가 필요하고, 그건 **정답 라벨 `G_q`가 있어야** 나온다.
- 라벨은 **오프라인**에만 있다. 운영 시점엔 `G_q`를 모른다 → **런타임에서 `Δ_k` 기반 종료는 불가능**하다.

따라서 이 아이디어는 두 층으로 갈라서 써야 한다:

| 층 | 언제 | 무엇을 정하나 | 종료 신호 |
|---|---|---|---|
| **오프라인 튜닝** | 평가셋에 라벨 있음 | 코퍼스 전역 운영점 `k*`(고정 상수) | `Δ_k < ε` (라벨 기반 — 정당) |
| **온라인 동적 top-k** | 운영, 라벨 없음 | 질의별 절단 위치 | **점수 프록시**(score gap·분포 급락) — 라벨 못 씀 |

`k*(q) = min{k : Hit@k(q)=1}`(최초 정답 순위)도 **정답을 알아야** 계산되는 오프라인 진단량이다. 동적 top-k로 쓰려면 이 값을 **점수 기반 대리 신호**(예: 인접 점수 gap이 벌어지는 지점)로 근사해야 하고, 그 근사의 타당성은 별도 검증 대상이다. 초안은 이 다리를 건너뛰었다.

### 3-3. 신규성 — "새 평가법"이 아니라 표준 IR의 재조립

`Recall@k`/`success@k` 곡선을 `k`에 대해 스윕(sweep)하는 건 정보검색(information retrieval)의 표준이다(R-precision, success curve 등). GPT가 붙인 `Saturation Curve`·`AUC@K`도 통용 표현이지 새 발명이 아니다. **PM의 실제 기여는 지표가 아니라 "한계증가량 조기 종료 + 비용 결합으로 운영 k를 정한다"는 절차화**다. 그 자리에 정직하게 무게를 실어야 과대포장을 피한다.

### 3-4. Hit@k 포화 ≠ 리랭킹 불필요

Hit@k는 **순위를 무시**(top-k 안에 있기만 하면 1)한다. 곡선이 포화해도 정답이 top-k 안에서 뒤쪽에 몰려 있을 수 있다. 리랭킹·컨텍스트 절약의 이득은 **순위 민감 지표(MRR·nDCG@k)**로 따로 봐야 한다. 실제 이 프로젝트의 phase0 리포트가 "리랭커 스킵" 판정을 내린 근거도 MRR/nDCG였지 Hit@k가 아니었다(§4).

---

## 4. 이 프로젝트(kr-history-bm25) 맥락 재해석

일반론을 넘어, 이 코퍼스에서 이 아이디어가 어디에 값을 하는가.

### 4-1. 최대 가치 = arm별 포화곡선 비교(절대 회수율 아님)

`data-driven-insight`·`trust-principle`상 이 도구의 "정답"은 열려 있어(발견 유도) 절대 Recall의 분모가 불안정하다. 그러므로 곡선을 **절대 성능이 아니라 인덱스 간 상대 진단**으로 읽는 게 정확하다:

- `bm25-han`(한자 원문, 신뢰근거) vs `bm25-ko`(직역 보조) vs `hybrid`의 **포화곡선을 겹쳐 그린다.**
- 곡선 사이 간격 = 보조 인덱스가 원문 BM25를 얼마나 "구원"하는지의 정량(phase0 §5의 `日食`·`ko-reading` 구원을 곡선 전체로 확장).
- **먼저·낮은 k에서 포화하는 arm이 그 질의 유형의 우세 검색기.** 이건 이원 인덱스 설계 정당성을 곡선 하나로 보여준다.

### 4-2. 라벨 희소가 진짜 병목

현재 라벨은 `eval/relevance.json`(12토픽·28질의, **DRAFT**)뿐이고 정답셋이 "앵커 한자 포함"이라는 렉시컬 기준이다(phase0 §7). k-스윕 곡선의 신뢰도는 이 qrels 품질에 종속된다. **곡선을 늘리기 전에 라벨 검수·확장이 선행**이어야 하며, 곡선은 그 전까지 "상대 비교용 진단"으로만 해석한다.

### 4-3. 재현성 결합(`krh-btf`)

`ε`·`p`·`max_k`·`k*`·arm별 곡선은 전부 `krh-btf` 재현성 매니페스트의 필드로 스탬프할 후보다. "해석은 달라도 실험은 재현"에 정확히 부합한다.

---

## 5. 권고(실행)

1. **오프라인 k-스윕을 기존 평가에 증분 추가.** `scripts/embedding-eval.mjs`가 이미 arm별 랭킹을 산출하므로, arm마다 `Hit@k`·`Recall@k`를 `k=1..K` 배열로 방출하고 `Δ_k`·`k*`·`AUC@K`를 붙인다. **새 파이프라인 불필요** — 두 점(R@5/R@10)을 전 구간 곡선으로 넓히는 것뿐.
2. **운영 상수 `k*`와 런타임 동적 top-k를 문서·코드에서 분리.** 전자는 라벨 기반 오프라인 산출, 후자는 점수 프록시(score-gap) 기반 — 절대 같은 함수로 구현하지 않는다(§3-2).
3. **순위 지표 병행 보고.** Hit@k 곡선만으로 리랭킹/절단을 결정하지 말고 MRR·nDCG@k를 함께 본다(§3-4).
4. **용어 고정.** MRR(역수 평균) ≠ MFRR(순위 평균). 문서·리포트에서 혼용 금지(§3-1).
5. **라벨 우선.** 곡선 확장 전 `eval/relevance.json` 검수·확장(§4-2). 그 전 결과는 "상대 진단"으로 라벨링.

---

## 6. 관련 이슈·자산

- [`krh-cvh-phase0-eval-report.md`](./krh-cvh-phase0-eval-report.md) — 이미 Recall@k·MRR·nDCG를 arm별로 산출. 본 아이디어의 실행 토대.
- `krh-btf` — 재현성 매니페스트. `ε`·`p`·`k*`·곡선을 실험 조건으로 고정.
- 메모리: `data-driven-insight`(발견 유도라 절대정답 열림) · `trust-principle`(한자 원문 우선) · `dual-index`(arm별 곡선 비교의 대상).

---

## 7. 선행연구 조사 결과 (2026-07-22, deep-research 6각도·23출처·25청구 3표 적대검증)

각 하위청구의 핵심 구성요소가 **모두 강한 1차 선행으로 확립**되어 있음을 확인했다. 종합 판정은 **(ii) 부분적 신규(조합·응용)** — "명확한 신규 방법"은 아니다.

- **하위청구 1 (깊이 스윕·포화)**: `Lu, Moffat & Culpepper (2016)`이 유틸리티 지표의 k-수렴(포화)과 잔차 상한 기반 평가 깊이 선택을 정식화. 🔴 **중대 경고**: 이들은 **recall 계열 지표는 포화 유비가 깨진다**고 명시 지목 — 우리가 쓰려는 Recall@k가 바로 그 계열이라, "Recall@k 포화로 운영 깊이 결정"은 방법론적 정당화가 필요하다(또는 RBP/ERR 등 유틸리티 계열로 대체).
- **하위청구 2 (stopping problem)**: `Cormack & Grossman Knee/Target (2016)`가 이득곡선 무릎점의 한계이득 중단 규칙으로 우리 발상의 **가장 근접한 정통 선행**. 그 위에 `Li & Kanoulas (TOIS 2020, 통계추정)`·`RLStop (SIGIR 2024, 강화학습)`·`Stevenson & Bin-Hezam (TOIS 2024, 점과정)`으로 "운영점 k* 선택"이 정식 하위분야로 확립.
- **하위청구 3 (RAG 동적 top-k·라벨프리 절단)**: `Surprise (SIGIR 2023, EVT/GPD)`·`Adaptive-k (EMNLP 2025, 최대격차)`·`TAA-k (ECML PKDD 2026, knee+EVT)`·`Meng RLT (SIGIR 2024)`·`heiDS (2025, RAG 적용)`로 **폭넓게 존재**. 🔴 우리의 "질의별 동적 top-k 확장"은 이 계열과 **직접 중복** — 확장 방향 자체는 신규 아님.
- **하위청구 4 (오프라인 지표·운영점)**: MRR·R-precision·success@k는 교과서 표준이나, 이번 검증 풀에 직접 인용 가능한 확증 출처가 부재 → **별도 근거 보강 필요**.

**남는 신규성(medium confidence, 부재 증명 불가)**: 학습식 early-stopping의 `Δ_k<ε · patience p회 연속` 규칙을 오프라인 Recall@k 스윕에 붙인 특정 절차는 대표 선행(단일 최대격차 knee, 기울기비 1/6, EVT 꼬리적합)과 **알고리즘 형태가 다름**. 단 이건 증분적이고, 회색문헌 위험이 남는다(아래 §9).

🔴 **회색문헌 신규성 위험**: 비피어리뷰 블로그 `TMLS "Retrieval Saturation: The Top-k Inflection"`이 이미 "retrieval saturation"을 단봉(single-peaked) 모델로 세우고 **닫힌형 최적 깊이 k\* = (1/α)ln(1+α/λ)** 를 제시. 프레이밍이 겹치므로 신규성 주장 시 반드시 대비·인용.

## 8. Related Work 후보표

> 검증 상태: ✅=서지 직접 확인 · ☑=핵심 사실 3표 검증(정확 제목 투고 전 재확인) · ⚠=최신 preprint(투고 직전 재조사)

| 버킷 | 논문 (저자·연도·venue) | 식별자 | 우리와의 관계 | 우선순위 | 상태 |
|---|---|---|---|---|---|
| 1 포화·깊이선택 | Lu, Moffat & Culpepper, "The effect of pooling and evaluation depth on IR metrics", Information Retrieval J. 19(4) (2016) | DOI 10.1007/s10791-016-9282-6 | **선행이자 위협** — recall 지표는 포화 안 함을 지목 | **must-cite** | ☑ |
| 2 stopping | Cormack & Grossman, "'When to Stop' — Waterloo participation, TREC 2016 Total Recall Track" (2016) | TREC 2016 | **가장 근접 선행** — 한계이득 무릎점 중단 | **must-cite** | ☑ |
| 2 stopping | Li & Kanoulas, "When to Stop Reviewing in Technology-Assisted Reviews", ACM TOIS (2020) | DOI 10.1145/3411755 | 목표 recall·잔차추정식 운영점 | must-cite | ☑ |
| 2 stopping | Yang, Lewis & Frieder, heuristic stopping methods, DocEng '21 (2021) | arXiv:2106.09871 | 휴리스틱 중단 규칙 비교 | 보조 | ☑ |
| 2 stopping | Bin-Hezam & Stevenson, "RLStop", SIGIR 2024 | DOI 10.1145/3626772.3657911 · arXiv:2405.02525 | 학습식 최적 중단점 | 보조 | ☑ |
| 2 stopping | Stevenson & Bin-Hezam, point-process stopping, ACM TOIS (2024) | arXiv:2311.08597 | rate function 중단점 | 보조 | ☑ |
| 3 동적 top-k | Bahri et al., "Surprise" (result list truncation via EVT), SIGIR 2023 | DOI 10.1145/3539618.3592066 | **라벨프리 절단 원조** | **must-cite** | ☑(제목 재확인) |
| 3 동적 top-k | Taguchi, Maekawa & Bhutani, "…No Tuning, No Iteration, Just Adaptive-k", EMNLP 2025 Main | arXiv:2506.08479 | **가장 근접 라벨프리 동적 top-k** — 최대격차 컷 | **must-cite** | ✅ |
| 3 동적 top-k | Song et al., "Tail-Aware Adaptive-k", ECML PKDD 2026 | arXiv:2606.11907 | knee+EVT 꼬리안정 절단 | must-cite | ✅⚠ |
| 3 동적 top-k | Meng et al., "Ranked List Truncation for LLM-based Re-Ranking", SIGIR 2024 | arXiv:2404.18185 | RLT→리랭커 비용절감 | 보조 | ☑ |
| 3 동적 top-k | heiDS, RAG query-dependent-k (2025) | arXiv:2506.19512 | fixed-k→surprise 대체(RAG 실적용) | 보조 | ☑⚠ |
| 4 오프라인 지표 | (근거 보강 필요) MRR·R-precision·success@k 표준 출처 — Buckley & Voorhees 계열 확정 예정 | — | 배경 지표 정의 | 보조 | 🔲 미확정 |

**must-cite 대비 기여 진술문(초안)**: "우리는 Adaptive-k(런타임 최대격차)·Surprise(EVT)·Cormack-Grossman Knee(한계이득 무릎)가 각각 다룬 *절단/중단* 문제를, **정답 라벨이 있는 오프라인 Recall@k 스윕 위에서 이원(한자/직역) BM25 인덱스의 운영 깊이를 진단**하는 문제로 재설정하고, 학습식 patience 규칙과 기존 knee/EVT를 동일 벤치마크에서 비교하며, 재현 가능한 오픈 아티팩트로 공개한다." — 이 문장이 살아남는지가 출판 가능성의 핵심.

## 9. 수정 판정 — 공학 신규성 재평가(정직 교정)

앞선 대화에서 "공학적 시도가 없으면 출판 가능"을 전제했으나, 조사 결과 **일반 RAG 층위에선 공학적 시도가 이미 활발**하다(Adaptive-k·TAA-k·heiDS가 프로덕션 RAG의 동적 top-k를 최근 다룸). 따라서:

- 🔴 **"아무도 공학적으로 안 했다"는 일반 방법 층위에선 거짓** — 순수 방법 신규성 주장(포화 조기종료/동적 top-k)은 고위험(리뷰어가 위 4편으로 즉시 반박).
- ✅ **살아남는 신규성 = 도메인 응용 + 아티팩트**: 전근대 한자 사료 이원 인덱스에 운영점 방법론을 적용·계측한 사례는 **공백**. 여기가 깨끗한 자리.
- **권장 출판 형태**: 방법 논문이 아니라 **리소스/응용 논문**(Digital Humanities · JCDL/TPDL · ECIR reproducibility/resource track). 기여 = 도메인 + 재현 레시피 + 오픈 아티팩트(npm 패키지·동봉 코퍼스·평가셋). 이 틀에선 위 선행이 경쟁자가 아니라 배경이 된다.
- **한계점·future work 배치**(§5 스코프 전략과 연결): 핵심 주장을 "오프라인 전역 운영점 k* 선택 + 도메인 계측"으로 좁히고, ①질의별 라벨프리 동적 top-k ②patience vs knee/EVT/RL 정면 비교 ③Recall@k→유틸리티(RBP/ERR) 대체는 future work로 명시.

---

## 10. 설계 고정 — 프레임 확정(2026-07-22 PM 협의)

여러 턴에 걸친 협의로 아래 프레임이 확정됐다. 이후 개요·집필의 기준.

**장르**: 응용 DM 프레임워크 논문(SCI 최상위 아님). 신규성 = *새 알고리즘*이 아니라 **기존 방법을 문제 구조에 맞게 조합한 프레임워크 설계 + 효율성 실증**. 표준 도구상자 = Witten·Frank·Hall, *Data Mining* 3e(Weka 책).

**기여의 본체 = 전처리(preprocessing)**. 한자 사료 → 검색가능 이원 표현 구성(직역·사전·정규화·entity)은 DM 용어로 Ch7 Data Transformations(§7.3 Text to Attribute Vectors·§7.5 Cleansing·§7.1 Attribute Selection). 도메인지식 주입은 §9.4·텍스트마이닝 §9.5.

**신규 twist = 전처리 품질을 "요즘 방식"으로 평가**. 전통 DM은 전처리를 다운스트림 정확도(Ch5)로 평가 → 우리는 **검색 운영점·포화(Recall-Cost)** 로 평가. 다리: 이 책 §5.7에 이미 Recall-Precision·Cost Curve가 있어 DM 독자에게 낯익음.

**개념 사슬(도입 서사)**: 혼동행렬(confusion matrix) → recall=TP/(TP+FN) → (컷오프 이동) §5.7 Recall-Precision Curve → (검색 깊이 k 이동) Recall-깊이 포화곡선 → 운영점 k\*. 우리 곡선 = 혼동행렬 recall의 **깊이 매개변수화**.

**이중 평가(완성도 핵심)**:
- **내재(intrinsic, 라벨-경량)**: 엔트로피·IG(§4.3·§7.1·§7.2·§5.6·§5.9). 항 분포에서 계산 → qrels 없이 표현 정보량 측정. Recall@k 분모 약점을 메움.
- **외재(extrinsic, 라벨-과다)**: Recall-Cost 운영점·포화.
- **다리(헤드라인 가설)**: 운영점 k\*가 항 분포 엔트로피로 설명·예측된다(낮은 엔트로피=일찍 포화). 실증하면 "곡선을 보여줌"→"왜 그런지 측정"으로 격상.

**🔴 정직 처리 필수(리뷰어 방어)**:
- 분류 recall(분모 확실) vs 검색 Recall@k(분모=|G_q|, 완전판정 필요) 구분 명시. 우리 판정 희소 → 상대 비교로 스코프.
- **Hit@k = 질의 단위 혼동행렬 성공률**(정답 1건만 있어도 됨) → 분모 문제 완화, DM 독자 공통어. Recall@k는 판정 채워지는 만큼 보조.
- 상호정보량 I(term;타깃)은 타깃(군집·관련성) 필요 / 무조건 엔트로피 H(term)은 라벨 불필요 — 두 층 구분해 사용.
- Lu et al.(2016): recall 계열은 포화 유비 깨짐 → 정당화하거나 유틸리티(RBP/ERR) 병행.

**효율성 논지(척추, PM 확정)**: 이원 인덱스 위 운영점 진단으로 **동일 회수율(iso-quality)에서 검색 비용 X% 절감**. 지표=Recall-Cost AUC. baseline=fixed top-k(naive) + Adaptive-k(강, 단 온라인 질의별이라 *이겨야 할 대상*이 아니라 상보/배경으로 위치).

**이원 인덱스 payoff**: phase0의 "직역이 구원한다"를 정보이론으로 정량화 — 직역이 발견 타깃 조건부 엔트로피를 낮춤/상호정보량↑.

## 11. 논문 개요 초안 (v0, 교과서 어휘)

> 대상: 응용 DM/디지털인문학. 후보 venue — 국내(정보과학회 KIISE·정보처리학회) 또는 JOCCH(ACM J. Computing and Cultural Heritage)·DMKD·ECML PKDD Applied·JCDL/TPDL. 재현 아티팩트 = npm `kr-history-bm25` + 동봉 코퍼스 + `eval/*`.

**가제(working title)**
- (EN) *Trust-Grounded Dual-Index Construction as a Preprocessing Framework for Knowledge Discovery in Premodern Sino-Korean Historical Corpora: An Information-Theoretic and Retrieval-Operating-Point Evaluation*
- (KR) 전근대 한자 사료 지식발견을 위한 신뢰-접지 이원 인덱스 전처리 프레임워크 — 정보이론·검색 운영점 이중 평가

**기여(Contributions)**
- **C1** 도메인지식 주입형 전처리(데이터 변환) 프레임워크 — 한자 원문(신뢰근거) + 직역·사전(보조)의 이원 표현. 설계가 *임의 조합이 아니라* 신뢰 제약(오역 배제)에 의해 강제됨.
- **C2** 전처리 품질의 이중 평가 — 내재(엔트로피/IG) + 외재(Recall-Cost 운영점) + 둘을 잇는 **엔트로피→포화 다리**(k\*를 엔트로피로 예측).
- **C3** 보조 인덱스 기여의 정보이론적 정량화 — 직역이 발견 타깃 조건부 엔트로피↓/상호정보량↑.
- **C4** 재현 가능한 오픈 아티팩트 — N종 사서에 동일 파이프라인 적용, 지명 공기 발견 사례(낙랑·遼水)로 serendipitous discovery 실증.

**파이프라인(Fig.1)**: 원사료 → [전처리: 정규화·간자체·독음·직역·entity] → 이원 BM25(+사전·+벡터) → [내재평가 엔트로피/IG] + [외재평가 RRF 하이브리드→운영점/포화] → 군집(공기/DBSCAN) → 발견 표면.

**섹션 구성**
1. **Introduction** — 혼동행렬→recall→깊이곡선 서사; 문제(전근대 한자 사료가 표준 마이닝에 저항, 국편위 오역 문제); 기여 4점.
2. **Background & Related Work** — (a) DM 전처리·데이터변환(Weka Ch7), (b) 정보이론 특징평가(§4.3·§7.1·§7.2·§5.6·§5.9), (c) 평가(Ch5, Recall-Precision/Cost §5.7), (d) IR 운영점·stopping(Lu et al.·Cormack-Grossman·Adaptive-k·Surprise = 배경/baseline), (e) 텍스트마이닝·도메인지식(§9.4·§9.5), (f) 공간인문학/역사 텍스트마이닝 ← *열린 검증 항목*.
3. **Framework: 신뢰-접지 이원 인덱스 전처리** — 설계 근거(trust-principle이 설계를 강제), 각 변환 단계.
4. **Evaluation Methodology** — 이중 평가 정의(내재 엔트로피/IG, 외재 운영점 k\* 선택, 다리 가설 k\*~엔트로피); 검색-recall 분모 정직 처리(라벨 희소, Hit@k=혼동행렬 성공률).
5. **Experiments & Results** — E1 인덱스/arm별 내재 정보량; E2 운영점 곡선·iso-quality 비용절감(vs fixed-k); E3 엔트로피↔k\* 다리; E4 ablation(arm 분해·이원vs단일·사전 on/off); E5 사서 간 일반화; E6 발견 사례연구.
6. **Discussion** — 프레임워크가 사는 것; 타 도메인 이식성(개인 방법론 자산).
7. **Limitations** — 라벨 희소(부분 qrels)·recall vs 유틸리티(Lu et al.)·단일 임베더/리랭커·오프라인 전역 k\*.
8. **Future Work** — 질의별 라벨프리 동적 top-k·patience vs knee/EVT/RL 정면 비교·유틸리티 운영점·qrels 확장.
9. **Conclusion** + 재현성 부록(아티팩트·버전 매니페스트 `krh-btf`).

**baseline**: fixed top-k(naive, 이기는 대상) · Adaptive-k(상보, 배경). **헤드라인 지표**: Recall-Cost AUC + 엔트로피↔k\* 상관.

**열린 검증(집필 전 1건)**: "전처리/표현 품질을 검색 포화·운영점으로 진단"한 선행 — DM 전처리평가 × IR 운영점 × 역사 텍스트마이닝 교집합(§2-f). 비면 신규성 확정, 차면 대비 대상.
