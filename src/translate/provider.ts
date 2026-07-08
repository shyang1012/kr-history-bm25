/**
 * @Project: kr-history-bm25
 * @File: provider.ts
 * @Description: 번역 provider 인터페이스 + 직역 프롬프트 빌더. context.md 원칙(직역·지명 한자 보존·확정 표현 금지)을 주입한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */

/** 번역 대상 본문의 문맥 정보 */
export interface PassageContext {
  /** 본문 id */
  passageId: number;
  /** 소속 노드 id */
  nodeId: string;
  /** 코퍼스 코드 */
  corpusCode?: string;
  /** 노드 제목 */
  nodeTitle?: string | null;
}

/** 번역 결과 */
export interface TranslationResult {
  /** 직역 텍스트 */
  text: string;
  /** 사용 모델 식별자 */
  model: string;
}

/** 번역 provider — 한자 원문을 한국어로 직역한다 */
export interface TranslationProvider {
  /** provider 이름(claude/cloudflare/codex 등) */
  readonly name: string;
  /**
   * 한자 원문을 직역한다.
   * @param han - 한자 원문(표점 포함)
   * @param ctx - 문맥 정보
   * @returns 직역 결과
   */
  translate(han: string, ctx: PassageContext): Promise<TranslationResult>;
}

/** 직역 원칙 시스템 프롬프트(context.md 반영) */
export const DIRECT_TRANSLATION_SYSTEM = [
  '당신은 한문 사료를 한국어로 "직역"하는 보조자입니다. 다음 원칙을 반드시 지키세요.',
  '1. 의역 금지 — 원문 구조와 어순에 충실한 직역만 합니다.',
  '2. 고유명사(지명·인명·관직·국명)의 한자는 번역하지 말고 한자 그대로 유지합니다.',
  '3. 확정·단정 표현을 지어내지 않습니다. 원문에 없는 해석·추정을 추가하지 않습니다.',
  '4. 원문에 없는 내용을 보태지 않습니다. 결과는 번역문만 출력합니다(설명·머리말 없이).',
].join('\n');

/**
 * 직역 요청 메시지를 구성한다.
 * @param han - 한자 원문
 * @param ctx - 문맥 정보
 * @returns 시스템/사용자 메시지
 */
export function buildMessages(han: string, ctx: PassageContext): { system: string; user: string } {
  const header = ctx.nodeTitle ? `[${ctx.nodeTitle}]\n` : '';
  return {
    system: DIRECT_TRANSLATION_SYSTEM,
    user: `${header}다음 한문을 위 원칙에 따라 한국어로 직역하세요.\n\n${han}`,
  };
}
