/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/src/orchestrator/registry.ts
 * @Description: code-wiz cw-owt9 이식(2026-07-17) — tool-use 1계층: Tool Registry / Tool Contract +
 *   invocation-level BudgetTracker. 범용 LLM 자율 도구 오케스트레이션 코어(R6 격리) — kr-history 도메인
 *   타입을 import하지 않는다.
 *     - ToolSpec: name+description+parameters(JSON schema)+gate(권한·allowlist)+cost+handler
 *     - ToolContext: 도구 실행 컨텍스트 (env·lang·cache·budget·provided 누적·actor/useCase 선반영)
 *     - BudgetTracker: 🔴 invocation 전체 공유 subrequest/latency/loop 상한
 *     - ToolRegistry: register / pick(subset) / toFunctionSchemas(OpenAI 호환 tools 배열)
 * @Author: shyang
 * @LastModified: 2026-07-17
 */

export type ToolUseLang = 'kr' | 'us' | 'jp';

/**
 * 도구별 env 서브셋 (도메인 중립 — 문자열 키/값). 호출자가 도구가 필요로 하는 값만 추려 주입한다.
 * 🔴 DB 등 stateful 자원은 여기 두지 않는다 — ctx.repo 등 별도 필드로 주입한다.
 */
export type ToolUseEnv = Record<string, string | undefined>;

/** gate 판정 결과 — 권한·allowlist 통과 여부. */
export type GateResult = { ok: true } | { ok: false; reason: string };

/**
 * 🔴 invocation-level 공유 예산 추적.
 *   멀티 run(예: 다국어 순차 생성)이 있는 호출자는 1개 인스턴스를 생성해 각 run의 orchestrator에
 *   동일 인스턴스를 주입해야 전체 subrequest 예산을 공유 차감한다(orchestrator 자체 생성 금지).
 */
export interface BudgetLimits {
  maxSubrequests: number; // invocation 전체 subrequest 상한 (tool-use 배정분)
  maxLatencyMs: number; // wall-clock 상한
  maxLoops: number; // 단일 orchestrator run의 멀티라운드 상한
}

export class BudgetTracker {
  private subUsed = 0;
  private readonly startedAt: number;
  private readonly now: () => number;

  constructor(
    private readonly limits: BudgetLimits,
    now: () => number = Date.now,
  ) {
    this.now = now;
    this.startedAt = now();
  }

  /** 남은 subrequest 예산. */
  remainingSubrequests(): number {
    return Math.max(0, this.limits.maxSubrequests - this.subUsed);
  }

  /** cost만큼 차감 가능한가 (subrequest + latency 둘 다 여유). */
  canSpend(cost: number): boolean {
    return this.remainingSubrequests() >= cost && !this.latencyExceeded();
  }

  /** subrequest 예산 차감 (cost=0 캐시 hit는 무차감). */
  spend(cost: number): void {
    if (cost > 0) {
      this.subUsed += cost;
    }
  }

  /** 경과 wall-clock(ms). */
  elapsedMs(): number {
    return this.now() - this.startedAt;
  }

  /** latency budget 초과 여부 (초과 시 orchestrator 도구 중단 → 즉시 응답). */
  latencyExceeded(): boolean {
    return this.elapsedMs() >= this.limits.maxLatencyMs;
  }

  get maxLoops(): number {
    return this.limits.maxLoops;
  }

  /** 관측용 스냅샷. */
  snapshot(): { subUsed: number; subRemaining: number; elapsedMs: number } {
    return {
      subUsed: this.subUsed,
      subRemaining: this.remainingSubrequests(),
      elapsedMs: this.elapsedMs(),
    };
  }
}

/**
 * 도구 실행 컨텍스트. orchestrator가 1개 생성해 모든 도구 호출에 전달.
 *   - cache: 도구별 재조회 회피 캐시 (grep/get은 캐시 hit → subrequest 0)
 *   - provided: 🔴 도구가 반환·게이트 통과해 누적한 출처 (도메인 중립 `unknown[]` — 소비 시점에 캐스팅)
 *   - actor/useCase: 향후 권한 게이트 확장 선반영 (현재 미사용 가능)
 */
export interface ToolContext {
  env: ToolUseEnv;
  lang: ToolUseLang;
  cache: Map<string, unknown>;
  budget: BudgetTracker;
  provided: unknown[];
  log: (line: string) => void;
  actor?: string;
  useCase?: string;
  /**
   * 🔴 요청 1회 공유 stateful 자원(예: DB repo) — 순환 회피 위해 unknown.
   *   도구별 개별 생성 금지(자원 누적 방지). 호출자가 1개 생성·주입하고 invocation 종료 시 dispose.
   */
  repo?: unknown;
  /** 🔴 client abort 전파 — orchestrator 루프·도구가 중단 체크. */
  signal?: AbortSignal;
}

/** JSON Schema (OpenAI function parameters 호환) — 느슨한 객체. */
export type JsonSchema = Record<string, unknown>;

/**
 * 도구 1개 계약. 새 도구 추가 = ToolSpec 1개 구현 + registry.register() 1줄.
 *   handler가 출처를 노출하면 게이트 통과분만 ctx.provided에 push (환각차단 누적).
 */
export interface ToolSpec<TArgs = Record<string, unknown>, TResult = unknown> {
  name: string;
  description: string;
  parameters: JsonSchema;
  /** 권한·allowlist 게이트 (예: SELECT-only / 도메인 allowlist / 캐시 url만). 없으면 항상 통과. */
  gate?: (args: TArgs, ctx: ToolContext) => GateResult;
  /** 이 호출의 subrequest 비용 (캐시 hit = 0). */
  cost: (args: TArgs, ctx: ToolContext) => number;
  handler: (args: TArgs, ctx: ToolContext) => Promise<TResult>;
}

/** OpenAI 호환 function schema (tools 배열 원소). */
export interface FunctionSchema {
  type: 'function';
  function: { name: string; description: string; parameters: JsonSchema };
}

export class ToolRegistry {
  private readonly specs = new Map<string, ToolSpec>();

  register(spec: ToolSpec): void {
    this.specs.set(spec.name, spec);
  }

  get(name: string): ToolSpec | undefined {
    return this.specs.get(name);
  }

  /** 호출자가 enable할 subset (등록 안 된 이름은 조용히 제외). */
  pick(names: string[]): ToolSpec[] {
    return names.map((n) => this.specs.get(n)).filter((s): s is ToolSpec => s !== undefined);
  }

  /** 모델 tools 배열 (OpenAI 호환 function schema). */
  toFunctionSchemas(names: string[]): FunctionSchema[] {
    return this.pick(names).map((s) => ({
      type: 'function',
      function: { name: s.name, description: s.description, parameters: s.parameters },
    }));
  }
}
