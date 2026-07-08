# kr-history-bm25 — 프로젝트 메모리 인덱스

세션 시작 시 이 파일을 읽는다. 상세는 각 항목 파일 참조.

## 운영 규율
- 개발 규율 준용: `D:\dev\devApps\code-wiz\docs\02_design\CW-AP-D03_개발표준정의서.md` (명명·TDD·SQL §11·리팩토링 §10·한국어 어휘 §13)
- 참고 프로젝트 규율: `D:\dev\devApps\docx-convert` (vitest·Conventional Commits·ESM·author shyang·MIT)
- 폴더 규칙: `docs/`=권위문서, `tmp/`=LLM 임시, `etc/`=PM 임시

## 설계 핵심
- 신뢰 근거 = 한자 원문. 제공 한글 번역 배제. 보조 인덱스 = 우리가 LLM으로 직역한 데이터.
- 이원 인덱스(주=한자 BM25 / 보조=직역 BM25). 토큰화 = 글자 unigram + FTS5 phrase.
- BM25 문서 단위 = `<paragraph>`, 군집 단위 = `node`(기사).
- 승인 계획서: `C:\Users\disro\.claude\plans\serene-sauteeing-hamming.md`
