/**
 * @Project: kr-history-bm25
 * @File: krh.e2e.test.ts
 * @Description: CLI e2e — `krh`를 서브프로세스로 실행해 배포 산출물(dist/cli/krh.js)의 stdout 계약을 검증한다.
 *               헤드라인 흐름(독음 검색 병기·간자체 질의 정규화·지명 간자체 병기)을 실제 명령으로 확인한다.
 *               동봉 코퍼스와 dist 빌드가 있을 때만 실행한다.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const cli = fileURLToPath(new URL('../../dist/cli/krh.js', import.meta.url));
const pkgVersion = (
  JSON.parse(
    readFileSync(fileURLToPath(new URL('../../package.json', import.meta.url)), 'utf8'),
  ) as { version: string }
).version;
const gz = fileURLToPath(new URL('../../data/history.sqlite.gz', import.meta.url));
const model = fileURLToPath(
  new URL('../../models/Xenova/multilingual-e5-small/onnx/model_quantized.onnx', import.meta.url),
);
const ready = existsSync(cli) && existsSync(gz);
const hybridReady = ready && existsSync(model);

/** krh 서브프로세스 실행 → stdout(UTF-8) */
function krh(...args: string[]): string {
  return execFileSync('node', [cli, ...args], { encoding: 'utf8', timeout: 120_000 });
}

describe.skipIf(!existsSync(cli))('krh CLI e2e — 버전 정합(빌드 산출물)', () => {
  it('--version stdout이 package.json version과 일치(하드코딩 드리프트 차단)', () => {
    const out = krh('--version');
    expect(out).toContain(pkgVersion);
  });
});

describe.skipIf(!ready)('krh CLI e2e (동봉 코퍼스)', () => {
  it('search --index reading — 독음으로 한자를 찾고 대표음(한자)〔관용〕 병기', () => {
    const out = krh('search', '강감찬', '--index', 'reading', '--limit', '2');
    expect(out).toContain('姜邯贊');
    expect(out).toContain('강감찬'); // 관용 병기
  });

  it('search --index han — 간자체 질의(辽东)를 정자로 정규화해 검색', () => {
    const out = krh('search', '辽东', '--index', 'han', '--limit', '2');
    expect(out).toContain('간자체 질의 정규화');
    expect(out).toContain('遼東');
  });

  it('cluster — 지명 이웃에 간자체 병기(간체 …)', () => {
    const out = krh('cluster', '遼東', '--neighbor-type', '지명', '--limit', '8');
    expect(out).toContain('간체');
  });

  it('place-clusters — seed 국소 퍼지 군집 stdout(seed·군집·[C…])', () => {
    const out = krh('place-clusters', '樂浪', '--scope', 'article');
    expect(out).toContain('seed=樂浪');
    expect(out).toContain('군집=');
    expect(out).toMatch(/\[C\d+\]/); // 군집 라벨
  });
});

describe.skipIf(!existsSync(cli))('krh CLI e2e — mcp install --print(부작용 없음)', () => {
  it('all --print — claude/codex 등록 명령 + gemini 스니펫 출력', () => {
    const out = krh('mcp', 'install', 'all', '--print');
    expect(out).toContain('claude mcp add kr-history');
    expect(out).toContain('codex mcp add kr-history');
    expect(out).toContain('"mcpServers"'); // gemini settings.json 스니펫
    expect(out).toContain('krh-mcp'); // 서버 bin
  });

  it('claude --print — -s scope + krh-mcp invocation', () => {
    const out = krh('mcp', 'install', 'claude', '--print');
    expect(out).toContain('claude mcp add kr-history -s user --');
    expect(out).toContain('krh-mcp');
  });
});

describe.skipIf(!hybridReady)('krh CLI e2e — 하이브리드(번들 모델)', () => {
  it('search --index hybrid — 낙랑(한글) 의미검색으로 樂浪 원문', () => {
    const out = krh('search', '낙랑', '--index', 'hybrid', '--limit', '10');
    expect(out).toContain('樂浪'); // 한글 독음→사전+벡터→한자 원문
    expect(out).toContain('의미검색'); // 벡터 arm 동작 표시
  }, 120_000);
});
