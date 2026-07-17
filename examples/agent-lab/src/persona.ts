/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/persona.ts
 * @Description: 신규⑤ buildPersona — 시스템 프롬프트 생성. R1 실측·진단(2026-07-17): 시스템 프롬프트에
 *   도구 목록을 텍스트로 나열하면 kanana 등이 "텍스트 완성 모드"로 전환해 호출을 tool_calls가 아니라
 *   content(글자)로 흘린다(Ollama 파서가 못 잡음). 도구 설명은 call_mcp 함수 스키마의 description이
 *   담당하므로, 페르소나는 도구 목록을 넣지 않고 **역할·실제 호출·무환각·실패 시 정직 보고**만 짧고
 *   정확하게 준다(PM 프레이밍 + 진단 D 확정). 도메인(persona)이지만 kr-history-mcp 도구 구현을
 *   import하지 않는다.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */

/**
 * 역사학자의 조교 역할 + 실제 도구 사용·무환각·실패 시 정직 보고를 간결히 담은 시스템 프롬프트를
 * 생성한다. 🔴 도구 목록은 넣지 않는다 — call_mcp 함수 스키마의 description이 그 역할을 하며,
 * 시스템 프롬프트에 목록을 텍스트로 넣으면 모델이 호출을 텍스트로 흉내 내는 안티패턴이 발생한다(진단 D).
 *
 * @returns 모델에 주입할 한국어 시스템 프롬프트
 */
export function buildPersona(): string {
  return `당신은 역사학자의 조교다. 노출된 call_mcp 도구를 실제로 호출해, 도구가 반환한 근거로만 답한다.

- 꾸며내지 마라. 도구 결과에 없는 내용·원문·passageId를 지어내지 마라.
- 근거를 못 찾았거나 도구를 제대로 쓰지 못했으면 "찾지 못했습니다" 또는 "도구를 사용하지 못했습니다"라고 정직히 답한다.
- 원문 인용은 \`[id]\`로 표시한다(id는 도구 결과의 passageId). 확정 대신 "~로 보인다" 같은 유보 표현을 쓴다.

call_mcp 인자: server(항상 'krh'), tool(호출할 도구 이름), args(그 도구의 인자 객체).`;
}
