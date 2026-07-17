/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/orchestrator/types.ts
 * @Description: code-wiz cw-owt9 이식(2026-07-17) — tool-use 모듈 간 인터페이스 계약
 *   (orchestrator ↔ ModelCaller ↔ tools 정합 경계). 범용 코어(R6 격리) — kr-history 도메인 타입을
 *   import하지 않는다. `OrchestratorResult.providedSources`는 도메인 중립 `unknown[]`로 확정하며,
 *   Evidence 등 도메인 타입은 agent 레이어(grounding.ts)에서 소비 시점에만 캐스팅한다.
 *     - ChatMessage / ToolCall: OpenAI 호환 멀티라운드 메시지
 *     - ModelCaller: orchestrator가 주입받는 "1턴 모델 호출" 함수 (백엔드 구현이 이 시그니처를 구현)
 *       → orchestrator는 특정 백엔드를 직접 import하지 않고 ModelCaller로 의존성 역전(테스트 mock 용이)
 *     - OrchestratorCaps / ToolUseMetrics / OrchestratorResult: 멀티라운드 루프 입출력
 * @Author: shyang
 * @LastModified: 2026-07-17
 */

import type { FunctionSchema } from './registry';

/** 모델이 요청한 도구 호출 1건 (OpenAI 호환). */
export interface ToolCall {
  id: string;
  /** 도구 이름. */
  name: string;
  /** 도구 인자 (JSON 문자열 — 모델 출력 그대로, orchestrator가 parse). */
  argumentsJson: string;
}

/** 멀티라운드 대화 메시지 (OpenAI 호환). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content?: string | null;
  /** assistant 턴이 도구를 호출한 경우. */
  tool_calls?: ToolCall[];
  /** role=tool 일 때, 응답 대상 tool_call id. */
  tool_call_id?: string;
}

/** 모델 1턴 호출 결과. */
export interface ModelTurn {
  /** assistant 본문 (도구만 호출하고 본문 없으면 ''). */
  content: string;
  /** 모델이 요청한 도구 호출 (없으면 빈 배열 = 최종 답변 턴). */
  toolCalls: ToolCall[];
  /** 토큰 usage (관측용, 선택). */
  usage?: Record<string, number>;
}

/**
 * 🔴 orchestrator가 주입받는 "1턴 모델 호출" 함수 (의존성 역전).
 *   백엔드 구현이 본 시그니처로 구현 → orchestrator는 백엔드 비의존.
 *   tool_choice:'auto' 고정. 1회 호출 = 1턴(모델 응답 1개). 멀티라운드 루프는 orchestrator가 관리.
 */
export type ModelCaller = (messages: ChatMessage[], tools: FunctionSchema[]) => Promise<ModelTurn>;

/** orchestrator 멀티라운드 상한 (호출자가 제공). BudgetTracker가 invocation 공유 강제. */
export interface OrchestratorCaps {
  /** 단일 run 멀티라운드 상한. */
  maxLoops: number;
  /** 도구별 호출 횟수 cap (절제된 grep 등). 미지정 = 무제한. */
  perToolCallCap?: Record<string, number>;
}

/** tool-use 실행 관측 지표 — 회귀 invariant. */
export interface ToolUseMetrics {
  modelCalls: number;
  toolCalls: Record<string, number>;
  fetchCount: number;
  subrequestEstimate: number;
  latencyMs: number;
  /** 🔴 loop cap 소진으로 중단됐는가. */
  truncatedByLoopCap: boolean;
  /** latency budget 소진으로 중단됐는가. */
  truncatedByLatency: boolean;
  /** 🔴 응답 필터 하네스가 finalText에서 내부 도구 노출을 제거했는가 (관측·모니터링). */
  toolLeakStripped?: boolean;
  usage?: Record<string, number>;
}

/** runToolUse 결과. */
export interface OrchestratorResult {
  finalText: string;
  /**
   * ctx.provided = 도구가 누적한 출처(도메인 중립 `unknown[]`).
   * 코어는 Evidence 등 구체 타입을 모른다 — 소비 시점(agent 레이어)에서 캐스팅한다.
   */
  providedSources: unknown[];
  metrics: ToolUseMetrics;
}
