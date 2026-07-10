# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work atomically
bd close <id>         # Complete work
bd dolt push          # Push beads data to remote
```

## Non-Interactive Shell Commands

**ALWAYS use non-interactive flags** with file operations to avoid hanging on confirmation prompts.

Shell commands like `cp`, `mv`, and `rm` may be aliased to include `-i` (interactive) mode on some systems, causing the agent to hang indefinitely waiting for y/n input.

**Use these forms instead:**
```bash
# Force overwrite without prompting
cp -f source dest           # NOT: cp source dest
mv -f source dest           # NOT: mv source dest
rm -f file                  # NOT: rm file

# For recursive operations
rm -rf directory            # NOT: rm -r directory
cp -rf source dest          # NOT: cp -r source dest
```

**Other commands that may prompt:**
- `scp` - use `-o BatchMode=yes` for non-interactive
- `ssh` - use `-o BatchMode=yes` to fail instead of prompting
- `apt-get` - use `-y` flag
- `brew` - use `HOMEBREW_NO_AUTO_UPDATE=1` env var

## Project Overview

**kr-history-bm25** — 한국사 사료 원문(한자)을 검색 가능한 SQLite BM25 코퍼스로 변환하는 도구.
한자 원문 BM25 전문검색을 1차 기준으로, 구조화된 지명·인명 색인, 공기(共起) 군집, 선택적 LLM 직역
보조 인덱스를 제공한다. **TypeScript 라이브러리 + `krh` CLI**, npm 공개(`kr-history-bm25`, MIT).
다음 최우선 = **MCP 서버**(`krh-gz6`). 사용자 문서는 `README.md`, Claude 전용 지식은 `CLAUDE.md`.

## Workflow Discipline

모든 에이전트(Claude·Codex·Gemini 등)는 아래 규율을 따른다.

1. **Plan Mode Default** — 비자명 작업(3+ 스텝 또는 아키텍처 결정)은 편집 전 계획을 먼저 세워
   승인받는다. 진행 중 이탈·예상 외 변경 조짐이 보이면 멈추고 즉시 재계획한다.
2. **Verification Before Done** — 동작을 증명하기 전엔 "완료"로 표시하지 않는다. 관련될 때 `main`
   대비 행동 차이를 확인하고, 테스트·로그로 정확성을 보인다.
3. **TDD + e2e** — 소스를 수정하면 대응 테스트를 쓰거나 갱신한다. 신규 기능엔 테스트, 버그 수정엔
   회귀 테스트. **e2e는 "배포 산출물이 실제로 동작하는가"** 를 검증한다:
   - **라이브러리** — `openBundledDb()`로 실제 동봉 코퍼스를 열어 `searchHan`·`cluster` 등이 기지
     결과(건수·이웃)를 반환하는지
   - **MCP** — 서버를 띄워 도구를 실제 호출, 스키마·반환 계약 검증 (LLM-facing이라 단위 테스트로
     안 잡히는 계약 파손을 여기서 잡는다)
   - **CLI** — `krh …`를 서브프로세스로 실행해 stdout 검증
4. **Simplicity / Root-cause** — 변경은 필요한 곳만 최소로. 임시방편 금지, 근본 원인을 고친다.
5. **Task·Memory = bd** — 이슈 추적은 `bd`(아래 Beads 블록), 지식은 `bd remember`. `tasks/todo.md`
   같은 파일 방식이나 TodoWrite를 쓰지 않는다.

## Quality Gates & Delivery

- **코드 게이트** — 완료·배포 주장 전 통과: `npm run validate`
  (= lint + format:check + tsc --noEmit + vitest).
- **e2e 게이트(제품 단계)** — 라이브러리·MCP·CLI e2e 통과. (전용 스크립트 `test:e2e` 신설 예정.)
- **PR 기반 배포** — `dev`→`main` **PR(`/배포`)** → main 머지 후 `v*` 태그 push →
  `.github/workflows/publish.yml`(npm OIDC Trusted Publisher, provenance)이 자동 publish.
  - `/push` = **dev 전용**, `/배포` = **main·npm 배포**.
  - 🔴 `main` 직접 커밋 금지, dev에서 직접 배포 금지.
- **절대 금지(모든 모드)** — `git push --force` / `git reset --hard` / 브랜치·태그 삭제 /
  운영 DB 파괴적 변경. 자발적 실행 금지.

## Tech Stack

- **런타임** — Node.js ≥20, ESM(`"type": "module"`).
- **언어** — TypeScript(strict). 번들 = tsup(ESM + CJS + d.ts).
- **DB 드라이버** — `@libsql/client` (+ `drizzle-orm/libsql`). 🔴 **better-sqlite3 금지**
  (Windows 네이티브 빌드 회피). FTS5 마이그레이션은 hand-written(drizzle-kit 미사용).
- **테스트** — vitest (`npm test` / `test:coverage`).
- **개발표준** — CW-AP-D03 준용(명명·파일헤더·SQL·TDD·리팩토링). 소스 서명 `shyang`.

<!-- BEGIN BEADS INTEGRATION v:1 profile:minimal hash:ca08a54f -->
## Beads Issue Tracker

This project uses **bd (beads)** for issue tracking. Run `bd prime` to see full workflow context and commands.

### Quick Reference

```bash
bd ready              # Find available work
bd show <id>          # View issue details
bd update <id> --claim  # Claim work
bd close <id>         # Complete work
```

### Rules

- Use `bd` for ALL task tracking — do NOT use TodoWrite, TaskCreate, or markdown TODO lists
- Run `bd prime` for detailed command reference and session close protocol
- Use `bd remember` for persistent knowledge — do NOT use MEMORY.md files

## Session Completion

**When ending a work session**, you MUST complete ALL steps below. Work is NOT complete until `git push` succeeds.

**MANDATORY WORKFLOW:**

1. **File issues for remaining work** - Create issues for anything that needs follow-up
2. **Run quality gates** (if code changed) - Tests, linters, builds
3. **Update issue status** - Close finished work, update in-progress items
4. **PUSH TO REMOTE** - This is MANDATORY:
   ```bash
   git pull --rebase
   bd dolt push
   git push
   git status  # MUST show "up to date with origin"
   ```
5. **Clean up** - Clear stashes, prune remote branches
6. **Verify** - All changes committed AND pushed
7. **Hand off** - Provide context for next session

**CRITICAL RULES:**
- Work is NOT complete until `git push` succeeds
- NEVER stop before pushing - that leaves work stranded locally
- NEVER say "ready to push when you are" - YOU must push
- If push fails, resolve and retry until it succeeds
<!-- END BEADS INTEGRATION -->
