# kr-history-bm25

국사편찬위원회 한국사데이터베이스 XML(삼국사기·삼국유사·고려사·고려사절요·한국고대사료집성)을
**검색 가능한 SQLite BM25 코퍼스**로 전환하는 TypeScript 라이브러리 + CLI.

원사료 기반 역사지리 연구를 위해, LLM에게 정제된 검색 결과를 제공하는 것을 목표로 한다.

## 설계 원칙

- **신뢰의 근거는 언제나 한자 원문.** 제공된 한글 번역은 원문과 무관하게 번역된 사례가 있어 채택하지 않는다.
- **이원 인덱스** — 주 인덱스는 한자 원문(BM25), 보조 인덱스는 우리가 직접 LLM으로 *직역*한 데이터.
- **한자 엄격 구분** — 글자 단위(unigram) 색인 + FTS5 구문 검색으로 동음이의 한자를 정확히 구분한다.
- **군집 분석 지지** — `<index>` 구조화 색인으로 지명·인물 조회와 기사 단위 co-occurrence(군집) 검색을 제공한다.

## 검색 프리미티브

| 기능 | API | CLI |
|---|---|---|
| 한자 전문검색(BM25) | `searchHan()` | `krh search "卒本"` |
| 직역 전문검색(보조) | `searchKo()` | `krh search "졸본" --index ko` |
| 지명·인물 구조 조회 | `lookupPlace()` | `krh place "遼西"` |
| 지명 군집(co-occurrence) | `cluster()` | `krh cluster "卒本"` |
| 이표기 동시검색(졸본=홀본) | `withVariants()` | — |

## 사용

```bash
# ① XML → SQLite 코퍼스 + 구조화 색인
krh ingest "source/…삼국사기 원문…" --db history.sqlite

# ② LLM 직역 → 보조 코퍼스 (증분·재개)
krh translate --provider claude --limit 100 --resume

# ③ 검색
krh search "卒本"
krh cluster "卒本"
krh place "遼西"
```

```ts
import { openHistoryDb } from 'kr-history-bm25';

const db = openHistoryDb('history.sqlite');
db.searchHan('卒本', { limit: 20 });
db.cluster('卒本', { scope: 'node' });
```

## 개발

```bash
npm install
npm test          # vitest
npm run build     # tsup → ESM + CJS + d.ts
npm run validate  # lint + format + typecheck + test
```

Node ≥ 20. 개발 규율은 `CW-AP-D03 개발표준정의서`를 준용한다(명명·TDD·SQL·리팩토링 표준).

## 라이선스

MIT © shyang
