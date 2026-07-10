/**
 * @Project: kr-history-bm25
 * @File: guide.ts
 * @Description: 역사지리 비정(比定) 방법론 가이드 — source/context.md 증류. MCP prompt로 노출한다.
 *               도구가 결론을 내지 않고, LLM이 원문·군집·지도 교차로 "고신뢰 비정 가능성"만 제시하도록 규율한다.
 * @Author: shyang
 * @LastModified: 2026-07-10
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

/** 비정 가이드 prompt 이름(클라이언트 호환 위해 ASCII) */
export const GUIDE_PROMPT_NAME = 'toponym-identification-guide';

/** context.md를 증류한 비정 방법론 본문 */
export const TOPONYM_GUIDE = `# 역사지리 비정(比定) 방법론

이 코퍼스는 결론을 제시하지 않는다. 아래 규율에 따라 "고신뢰 비정 가능성" 수준만 도출하라.

## 1. 원문 최우선
- 신뢰의 기준은 언제나 한자 원문이다. 제공된 한글 번역은 오역 이력이 있어 근거로 쓰지 않는다.
- 고유명사(지명·인명·관직)는 \`search_han\`(한자)로, 사건·현상·서술어는 \`search_ko\`(직역)로 찾는다.

## 2. 군집으로만 판단
- 지명 단독 비교는 허용하지 않는다. 반드시 \`cluster\`로 같은 기사에 공기(共起)하는 주변 지명과의
  군집으로 판단한다. 동일 반경 내 행정·방어·교통·산·하천 지명이 함께 존재해야 한다.
- 지명 변화·동일성이 사서에 명시된 경우(예: 졸본=홀본)는 \`with_variants\`로 두 표기를 함께 검색한다.

## 3. 수계(하천) 위계 코드
- 하(河)=황하급 대하, 강(江)=양자강급, 수(水)=중·소 하천, 천(川)=지류·계곡급.
- 현대 지형 크기가 아니라 사서의 용례를 따른다.

## 4. 지도 교차 검증
- 바이두 지도 · 구글 고지도 · 구글 현대지도에서 지형 자료를 확보한다(확보는 사용자·클라이언트 몫).
- 순서: 사서 지리지 서술 → 시대별 지리 데이터 → 현대 지도. 서술 순서·공간 배열이 일치해야 한다.
- 고지도·지리지 설명·현대 지도가 **동시에 일치**할 때만 채택한다.

## 5. 천문 기록
- 일식·월식 기록을 핵심 검증 도구로 쓴다. 관측지는 해당 국가의 수도·부도일 가능성이 높다.

## 6. 해석 제한
- 확정·단정 표현을 쓰지 않는다. "고신뢰 비정 가능성", "군집 기준에서 가장 일치" 수준만 허용한다.
- AI는 결론 제시자가 아니라 논증 정리·구조화·검증 보조다. 최종 판단은 사람의 몫이다.`;

/**
 * 비정 방법론 가이드를 MCP prompt로 등록한다(무인자).
 * @param server - McpServer 인스턴스
 */
export function registerGuidePrompt(server: McpServer): void {
  server.registerPrompt(
    GUIDE_PROMPT_NAME,
    {
      title: '역사지리 비정 가이드',
      description:
        '사서 원문·군집·지도를 교차해 지명을 비정하는 방법론(확정 표현 금지, 결론은 사람 몫).',
    },
    () => ({
      messages: [
        {
          role: 'user' as const,
          content: { type: 'text' as const, text: TOPONYM_GUIDE },
        },
      ],
    }),
  );
}
