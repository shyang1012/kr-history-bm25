/**
 * @Project: kr-history-bm25 (agent-lab)
 * @File: examples/agent-lab/eval/report.ts
 * @Description: eval 리포트 — F-02 지표 집계(aggregateMetrics 순수함수) + queries.json 구동 스크립트.
 *   aggregateMetrics는 MetricRow[](각 질의의 grounding·outcomes)로부터 메타도구 구성 실패율·도구호출
 *   성공률·[id] 인용률·미접지 id율·surface 접지 정성 라벨을 계산하는 순수 함수(테스트 가능, Task 9 Step 3).
 *   하단 실행 스크립트는 queries.json을 로드해 runQuery로 각 질의를 실행하고 집계 결과를 출력한다
 *   (import.meta.url 가드 — import 시 부작용 없음, 직접 실행 시에만 구동). 진단은 console.error.
 * @Author: shyang
 * @LastModified: 2026-07-17
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import type { GroundingReport } from '../src/grounding';
import type { CallRecord } from '../src/call-mcp-tool';
import { runQuery } from '../src/run';

const EVAL_DIR = path.dirname(fileURLToPath(import.meta.url));
const QUERIES_PATH = path.join(EVAL_DIR, 'queries.json');

/** queries.json 질의 1건. */
interface EvalQuery {
  id: string;
  query: string;
  expectTools?: string[];
  note?: string;
}

/** queries.json 최상위 형상. */
interface EvalQueriesFile {
  queries: EvalQuery[];
}

/** aggregateMetrics 입력 1행 — 질의 1건의 접지 판정 + call_mcp 계측. */
export interface MetricRow {
  grounding: GroundingReport;
  outcomes: CallRecord[];
}

/** aggregateMetrics 출력 — §8·§9 지표 5종. */
export interface ReportSummary {
  /** (unknown-tool + invalid-args) / 총 call_mcp 시도. 시도 0이면 0. */
  toolConfigFailureRate: number;
  /** success / (success + bridge-error). 분모 0이면 1(호출 자체가 없으면 실패도 없다는 관례상 vacuous). */
  toolCallSuccessRate: number;
  /** citedIds가 1개 이상인 질의 수 / 총 질의 수. */
  citationRate: number;
  /** Σ ungroundedIds.length / Σ citedIds.length. Σcited가 0이면 0. */
  ungroundedIdRate: number;
  /** surface 접지 정성 라벨 — 전 행 surfaceHits 총 개수 + 중복 제거 목록. */
  surfaceGrounding: { hitCount: number; surfaces: string[] };
}

/**
 * 질의별 grounding·outcomes 행을 §8·§9 지표로 집계하는 순수 함수.
 *
 * @param rows 질의별 GroundingReport + CallRecord[] 목록
 * @returns 메타도구 구성 실패율·도구호출 성공률·인용률·미접지 id율·surface 접지 라벨
 */
export function aggregateMetrics(rows: MetricRow[]): ReportSummary {
  let totalAttempts = 0;
  let configFailures = 0;
  let success = 0;
  let bridgeError = 0;
  let citedQueries = 0;
  let citedTotal = 0;
  let ungroundedTotal = 0;
  let hitCount = 0;
  const surfaces = new Set<string>();

  for (const row of rows) {
    for (const outcome of row.outcomes) {
      totalAttempts += 1;
      if (outcome.outcome === 'unknown-tool' || outcome.outcome === 'invalid-args') {
        configFailures += 1;
      } else if (outcome.outcome === 'success') {
        success += 1;
      } else if (outcome.outcome === 'bridge-error') {
        bridgeError += 1;
      }
    }
    if (row.grounding.citedIds.length > 0) {
      citedQueries += 1;
    }
    citedTotal += row.grounding.citedIds.length;
    ungroundedTotal += row.grounding.ungroundedIds.length;
    hitCount += row.grounding.surfaceHits.length;
    for (const s of row.grounding.surfaceHits) {
      surfaces.add(s);
    }
  }

  const toolConfigFailureRate = totalAttempts > 0 ? configFailures / totalAttempts : 0;
  const toolCallSuccessRate = success + bridgeError > 0 ? success / (success + bridgeError) : 1;
  const citationRate = rows.length > 0 ? citedQueries / rows.length : 0;
  const ungroundedIdRate = citedTotal > 0 ? ungroundedTotal / citedTotal : 0;

  return {
    toolConfigFailureRate,
    toolCallSuccessRate,
    citationRate,
    ungroundedIdRate,
    surfaceGrounding: { hitCount, surfaces: [...surfaces] },
  };
}

/** 비율을 백분율 문자열로 표시한다. */
function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

/** ReportSummary를 콘솔용 마크다운 표로 렌더링한다. */
function formatReportMarkdown(summary: ReportSummary): string {
  const rows = [
    ['메타도구 구성 실패율', pct(summary.toolConfigFailureRate)],
    ['도구호출 성공률', pct(summary.toolCallSuccessRate)],
    ['[id] 인용률', pct(summary.citationRate)],
    ['미접지 id율', pct(summary.ungroundedIdRate)],
    ['surface 접지(개수)', String(summary.surfaceGrounding.hitCount)],
    ['surface 접지(목록)', summary.surfaceGrounding.surfaces.join(', ') || '(없음)'],
  ];
  const lines = ['| 지표 | 값 |', '| --- | --- |', ...rows.map(([k, v]) => `| ${k} | ${v} |`)];
  return lines.join('\n');
}

/** queries.json을 읽어 파싱한다. */
function loadQueries(): EvalQueriesFile {
  const raw = readFileSync(QUERIES_PATH, 'utf-8');
  return JSON.parse(raw) as EvalQueriesFile;
}

/**
 * queries.json의 질의를 순서대로 runQuery로 실행하고(after 중심; 첫 질의만 before 비교(#5) 포함),
 * grounding·outcomes를 모아 aggregateMetrics로 집계한 뒤 마크다운 표를 stdout에 출력한다.
 */
async function main(): Promise<void> {
  const { queries } = loadQueries();
  const rows: MetricRow[] = [];

  for (const [index, q] of queries.entries()) {
    console.error(`[eval] 실행: ${q.id} — ${q.query}`);
    const result = await runQuery(q.query, { before: index === 0 });
    rows.push({ grounding: result.grounding, outcomes: result.outcomes });
    if (result.before !== undefined) {
      console.error(`[eval] ${q.id} before: ${result.before}`);
    }
    console.error(`[eval] ${q.id} after: ${result.after.finalText}`);
  }

  const summary = aggregateMetrics(rows);
  console.log(formatReportMarkdown(summary));
}

// 직접 실행(`tsx eval/report.ts`)될 때만 구동한다 — import 시(테스트의 aggregateMetrics 단독 사용 등)
// Ollama/MCP를 건드리지 않는다.
if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((err: unknown) => {
    console.error(`[agent-lab eval] 오류: ${(err as Error).message}`);
    process.exitCode = 1;
  });
}
