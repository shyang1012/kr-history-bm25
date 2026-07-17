/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/orchestrator/sanitize-tool-leak.ts
 * @Description: code-wiz cw-owt9 이식(2026-07-17) — tool-use 내부 도구 노출 차단 하네스(응답 필터).
 *   모델 최종 답변(finalText)에서 내부 도구 실명 + 난독화 opaque 호출패턴이 든 라인을 제거하고,
 *   leak로 빈 껍데기가 된 heading/label 라인까지 정리한다. 프롬프트 준수에 의존하지 않는 결정론적 backstop.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */

/** 정규식 메타문자 escape. */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** heading 라인 여부 (markdown # 또는 번호 섹션 "3. ..."). */
function isHeadingLine(trimmed: string): boolean {
  return /^#{1,6}\s/.test(trimmed) || /^\d+\.\s/.test(trimmed);
}

/** 값 없는 label bullet 여부 ("- 라벨:" / "- **라벨:**") — 내용은 하위 들여쓰기에 의존. */
function isLabelBulletLine(trimmed: string): boolean {
  return /^[-*]\s+\*{0,2}[^*\n]+\*{0,2}\s*[:：]\s*$/.test(trimmed);
}

/** 라인 들여쓰기 폭. */
function indentOf(line: string): number {
  return line.length - line.replace(/^\s*/, '').length;
}

/**
 * 내부 도구 노출 차단 — 실명/opaque 호출패턴이 든 라인 제거 + 빈 heading·label 정리.
 *
 * @param text 모델 최종 답변 본문
 * @param toolNames 내부 도구 실명 목록 (registry tool names)
 * @returns { text: 정제 본문, leaked: 제거 발생 여부 }
 */
export function stripInternalToolLeak(
  text: string,
  toolNames: string[],
): { text: string; leaked: boolean } {
  if (!text) {
    return { text: '', leaked: false };
  }

  // 내부 도구 실명(substring, 대소문자 무시) 또는 난독화 opaque 호출패턴(t1( / t12 ( 등)
  const namePattern = toolNames.filter(Boolean).map(escapeRegExp).join('|');
  const tokenRe = new RegExp(`(${namePattern || '(?!x)x'})|\\bt\\d+\\s*\\(`, 'i');

  let leaked = false;
  let lines = text.split('\n');

  // pass 1 — leak 토큰이 든 라인 제거
  lines = lines.filter((l) => {
    if (tokenRe.test(l)) {
      leaked = true;
      return false;
    }
    return true;
  });

  // pass 2 — 자식 잃은 label bullet / 내용 없는 heading 반복 정리 (제거가 상위를 고아로 만듦)
  let changed = true;
  while (changed) {
    changed = false;
    const out: string[] = [];
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i]!;
      const trimmed = line.trim();

      // 다음 non-blank 라인 탐색
      let j = i + 1;
      while (j < lines.length && lines[j]!.trim() === '') {
        j++;
      }
      const next = j < lines.length ? lines[j]! : null;
      const nextTrimmed = next?.trim() ?? null;

      // 내용 없는 heading: 다음이 heading이거나 EOF
      if (isHeadingLine(trimmed) && (nextTrimmed === null || isHeadingLine(nextTrimmed))) {
        changed = true;
        continue;
      }

      // 자식 잃은 label bullet: 다음이 더 깊은 들여쓰기가 아님(같거나 얕음) 또는 EOF
      if (isLabelBulletLine(trimmed) && (next === null || indentOf(next) <= indentOf(line))) {
        changed = true;
        continue;
      }

      out.push(line);
    }
    lines = out;
  }

  // 3+ 연속 공백라인 collapse + trim
  const result = lines
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return { text: result, leaked };
}
