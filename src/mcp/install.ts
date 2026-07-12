/**
 * @Project: kr-history-bm25
 * @File: install.ts
 * @Description: `krh mcp install` 구현. kr-history-bm25 MCP(stdio) 서버를 Claude Code·Codex·Gemini에 자동 등록한다.
 *               Claude/Codex는 각 CLI의 `mcp add`에 위임, Gemini는 settings.json JSON 병합.
 *               OS-aware 서버 invocation(Windows는 cmd 래핑) + launcher 전략 분리(.exe 직접/.cmd는 cmd.exe /c) +
 *               spawnSync 반환 분기(ENOENT=미설치 / EPERM·EINVAL=launcher·권한). 순수 빌더는 단위 테스트, 실행부는 e2e.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';
import { PACKAGE_NAME, MCP_BIN } from '../constants';

/** `mcp add` 위임 대상(자기 설정 포맷을 스스로 관리하는 CLI) */
export type DelegatedClient = 'claude' | 'codex';
/** 등록 지원 클라이언트 전체 */
export type McpClient = DelegatedClient | 'gemini';
/** 등록 범위 */
export type InstallScope = 'user' | 'local' | 'project';

/** 각 client config에 실제 저장되는 서버 기동 명령 */
export interface ServerInvocation {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** buildServerInvocation 입력 */
export interface InvocationOptions {
  /** 전역 krh-mcp bin 강제 사용 */
  global?: boolean;
  /** PATH에 krh-mcp가 이미 있는지(런타임 감지 결과 주입) */
  hasGlobalBin?: boolean;
  /** 커스텀 코퍼스 경로(KRH_DB) */
  db?: string;
  /** 대상 플랫폼(테스트 주입, 기본 process.platform) */
  platform?: NodeJS.Platform;
}

/** OS 무관 서버 실행 대상(래핑 전) */
function rawTarget(opts: InvocationOptions): { command: string; args: string[] } {
  if (opts.global || opts.hasGlobalBin) {
    return { command: MCP_BIN, args: [] };
  }
  return { command: 'npx', args: ['-y', '-p', PACKAGE_NAME, MCP_BIN] };
}

/**
 * client config에 저장할 서버 invocation을 만든다(OS-aware).
 * Windows는 raw `npx`/`.cmd`를 못 띄우는 host가 있어 `cmd /d /s /c`로 래핑한다(F-02).
 * @param opts - 실행 대상·플랫폼·db
 * @returns command/args(+env) 형태의 서버 기동 명령
 */
export function buildServerInvocation(opts: InvocationOptions = {}): ServerInvocation {
  const platform = opts.platform ?? process.platform;
  const target = rawTarget(opts);
  const env = opts.db ? { KRH_DB: opts.db } : undefined;
  if (platform === 'win32') {
    return { command: 'cmd', args: ['/d', '/s', '/c', target.command, ...target.args], env };
  }
  return { command: target.command, args: target.args, env };
}

/** buildClientCommand 입력 */
export interface ClientCommandOptions {
  name: string;
  scope: InstallScope;
}

/**
 * Claude/Codex의 `mcp add` argv를 만든다(순수 함수).
 * Claude는 `-s <scope>`·`-e K=V`, Codex는 scope 미지원·`--env K=V`. 서버 invocation은 `--` 뒤에 그대로 전개.
 * @param client - claude | codex
 * @param opts - 등록 이름·범위
 * @param invocation - buildServerInvocation 결과
 * @returns 호출할 CLI 이름과 argv
 */
export function buildClientCommand(
  client: DelegatedClient,
  opts: ClientCommandOptions,
  invocation: ServerInvocation,
): { cli: string; argv: string[] } {
  const envFlag = client === 'claude' ? '-e' : '--env';
  const envArgs = invocation.env
    ? Object.entries(invocation.env).flatMap(([k, v]) => [envFlag, `${k}=${v}`])
    : [];
  const tail = ['--', invocation.command, ...invocation.args];
  if (client === 'claude') {
    return {
      cli: 'claude',
      argv: ['mcp', 'add', opts.name, '-s', opts.scope, ...envArgs, ...tail],
    };
  }
  // codex — scope 플래그 미지원(전역 config.toml 기본)
  return { cli: 'codex', argv: ['mcp', 'add', opts.name, ...envArgs, ...tail] };
}

/**
 * Claude/Codex의 `mcp remove` argv를 만든다(순수 함수, --force 재등록용).
 * @param client - claude | codex
 * @param name - 제거할 등록 이름
 * @param scope - 범위(claude만 -s 사용)
 * @returns 호출할 CLI 이름과 argv
 */
export function buildRemoveCommand(
  client: DelegatedClient,
  name: string,
  scope: InstallScope,
): { cli: string; argv: string[] } {
  if (client === 'claude') {
    return { cli: 'claude', argv: ['mcp', 'remove', name, '-s', scope] };
  }
  return { cli: 'codex', argv: ['mcp', 'remove', name] };
}

/**
 * Gemini settings.json의 `mcpServers[name]`에 넣을 config 조각을 만든다(순수 함수).
 * @param invocation - buildServerInvocation 결과
 * @returns command/args(+env) 객체
 */
export function buildGeminiConfig(invocation: ServerInvocation): Record<string, unknown> {
  const cfg: Record<string, unknown> = { command: invocation.command, args: invocation.args };
  if (invocation.env) {
    cfg.env = invocation.env;
  }
  return cfg;
}

/** 실행 launcher — 찾은 실행파일 + 앞에 붙일 인자(예: cmd.exe /d /s /c) */
export interface Launcher {
  command: string;
  prefixArgs: string[];
}

/**
 * 후보 실행경로들에서 실행 전략을 고른다(F-01, 반순수 — 후보 주입 시 단위 테스트).
 * Windows: `.exe`는 직접, `.cmd`/`.bat`은 `cmd.exe /d /s /c`로 래핑(shell:false 유지),
 * 확장자 없는 npm bash shim은 spawn 불가라 제외. POSIX: 첫 후보 직접.
 * @param candidates - where/which 출력 경로 목록
 * @param platform - 대상 플랫폼
 * @returns 실행 전략 또는 null(미해석=미설치 취급)
 */
export function chooseLauncher(candidates: string[], platform: NodeJS.Platform): Launcher | null {
  const list = candidates.map((c) => c.trim()).filter(Boolean);
  const [first] = list;
  if (first === undefined) {
    return null;
  }
  if (platform !== 'win32') {
    return { command: first, prefixArgs: [] };
  }
  const exe = list.find((c) => /\.exe$/i.test(c));
  if (exe) {
    return { command: exe, prefixArgs: [] };
  }
  const cmd = list.find((c) => /\.(cmd|bat)$/i.test(c));
  if (cmd) {
    return { command: 'cmd.exe', prefixArgs: ['/d', '/s', '/c', cmd] };
  }
  return null; // 확장자 없는 shim만 남음 — 직접 spawn 불가
}

/** where(win)/which(posix)로 실행경로 후보를 찾는다 */
function findCandidates(cli: string, platform: NodeJS.Platform): string[] {
  const finder = platform === 'win32' ? 'where' : 'which';
  const r = spawnSync(finder, [cli], { encoding: 'utf8', shell: false });
  if (r.status !== 0 || typeof r.stdout !== 'string') {
    return [];
  }
  return r.stdout.split(/\r?\n/);
}

/**
 * CLI 실행 전략을 해석한다.
 * @param cli - 실행 파일명(claude/codex)
 * @param platform - 대상 플랫폼
 * @returns Launcher 또는 null(미설치)
 */
export function resolveLauncher(
  cli: string,
  platform: NodeJS.Platform = process.platform,
): Launcher | null {
  return chooseLauncher(findCandidates(cli, platform), platform);
}

/** 위임 실행 판정 — 정상/이미 존재/미설치/기타 실패 사유 */
export type DelegatedOutcome = 'ok' | 'already-exists' | 'not-installed' | string;

/**
 * spawnSync 반환을 원인별로 분류한다(순수 함수, F-03 + already-exists 구분).
 * @param r - error.code·status·signal·output(stdout+stderr 합본)
 * @returns 판정 결과
 */
export function classifyDelegatedResult(r: {
  error?: { code?: string };
  status: number | null;
  signal: string | null;
  output: string;
}): DelegatedOutcome {
  if (r.error) {
    const code = r.error.code;
    return code === 'ENOENT' ? 'not-installed' : `launch-error:${code ?? 'unknown'}`;
  }
  if (r.signal) {
    return `signal:${r.signal}`;
  }
  if (r.status === 0) {
    return 'ok';
  }
  if (/already exists/i.test(r.output)) {
    return 'already-exists';
  }
  return `exit:${r.status ?? 'unknown'}`;
}

/** Claude/Codex CLI를 pipe로 실행하고, 캡처 출력을 재출력한 뒤 분류한다 */
function runDelegated(cli: string, argv: string[], platform: NodeJS.Platform): DelegatedOutcome {
  const launcher = resolveLauncher(cli, platform);
  if (!launcher) {
    return 'not-installed';
  }
  const r = spawnSync(launcher.command, [...launcher.prefixArgs, ...argv], {
    encoding: 'utf8',
    shell: false,
  });
  const stdout = r.stdout ?? '';
  const stderr = r.stderr ?? '';
  if (stdout) {
    process.stdout.write(stdout);
  }
  if (stderr) {
    process.stderr.write(stderr);
  }
  return classifyDelegatedResult({
    error: r.error as NodeJS.ErrnoException | undefined,
    status: r.status,
    signal: r.signal,
    output: `${stdout}\n${stderr}`,
  });
}

/** Claude/Codex `mcp remove`를 조용히 실행한다(--force 재등록 전 정리, 결과 무시) */
function runRemove(cli: string, argv: string[], platform: NodeJS.Platform): void {
  const launcher = resolveLauncher(cli, platform);
  if (!launcher) {
    return;
  }
  spawnSync(launcher.command, [...launcher.prefixArgs, ...argv], {
    encoding: 'utf8',
    shell: false,
  });
}

/** Gemini settings.json 경로(scope별) */
function geminiSettingsPath(scope: InstallScope, platform: NodeJS.Platform): string {
  if (scope === 'project') {
    return join(process.cwd(), '.gemini', 'settings.json');
  }
  const home =
    platform === 'win32' ? (process.env.USERPROFILE ?? homedir()) : (process.env.HOME ?? homedir());
  return join(home, '.gemini', 'settings.json');
}

/**
 * 기존 settings.json 문자열에 `mcpServers[name]`을 병합한다(순수 함수 — 기존 키 보존 검증).
 * @param existing - 기존 파일 내용(없으면 null)
 * @param name - 서버 이름
 * @param cfg - buildGeminiConfig 결과
 * @returns 저장할 JSON 문자열과 덮어쓰기 여부
 */
export function mergeGeminiSettings(
  existing: string | null,
  name: string,
  cfg: Record<string, unknown>,
): { json: string; overwritten: boolean } {
  const root = existing ? (JSON.parse(existing) as Record<string, unknown>) : {};
  const servers = (root.mcpServers as Record<string, unknown> | undefined) ?? {};
  const overwritten = Object.prototype.hasOwnProperty.call(servers, name);
  servers[name] = cfg;
  root.mcpServers = servers;
  return { json: `${JSON.stringify(root, null, 2)}\n`, overwritten };
}

/** Gemini settings.json에 원자적으로 병합 저장한다 */
function installGemini(
  cfg: Record<string, unknown>,
  name: string,
  scope: InstallScope,
  platform: NodeJS.Platform,
): { overwritten: boolean; path: string } {
  const path = geminiSettingsPath(scope, platform);
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : null;
  const { json, overwritten } = mergeGeminiSettings(existing, name, cfg);
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, json, 'utf8');
  renameSync(tmp, path); // 원자적 교체 — 병합 중 오류 시 원본 훼손 방지
  return { overwritten, path };
}

/** runInstall 입력 */
export interface InstallCliOptions {
  name: string;
  scope: InstallScope;
  db?: string;
  global?: boolean;
  print?: boolean;
  /** 기존 등록을 remove 후 재등록(갱신) */
  force?: boolean;
  platform?: NodeJS.Platform;
}

/** 등록 대상 클라이언트 전체 */
const ALL_CLIENTS: McpClient[] = ['claude', 'codex', 'gemini'];

/**
 * `krh mcp install` 오케스트레이션. client별로 위임 실행 또는 settings 병합, `--print` 시 명령/스니펫만 출력.
 * @param clientArg - claude | codex | gemini | all
 * @param opts - 이름·범위·db·global·print·platform
 */
export function runInstall(clientArg: string, opts: InstallCliOptions): void {
  const platform = opts.platform ?? process.platform;
  const targets: McpClient[] = clientArg === 'all' ? ALL_CLIENTS : [clientArg as McpClient];
  for (const t of targets) {
    if (!ALL_CLIENTS.includes(t)) {
      throw new Error(`알 수 없는 클라이언트: ${t} (claude|codex|gemini|all)`);
    }
  }
  const invocation = buildServerInvocation({ global: opts.global, db: opts.db, platform });
  if (opts.db && !existsSync(opts.db)) {
    console.error(`[mcp install] 경고: --db 경로가 존재하지 않습니다: ${opts.db}`);
  }

  for (const client of targets) {
    if (client === 'gemini') {
      const cfg = buildGeminiConfig(invocation);
      if (opts.print) {
        const path = geminiSettingsPath(opts.scope, platform);
        const snippet = JSON.stringify({ mcpServers: { [opts.name]: cfg } }, null, 2);
        console.log(`# gemini — ${path} 에 병합:\n${snippet}`);
        continue;
      }
      const { overwritten, path } = installGemini(cfg, opts.name, opts.scope, platform);
      const note = overwritten ? ` · 기존 '${opts.name}' 교체(다른 이름은 --name)` : '';
      console.log(`[gemini] ${overwritten ? '덮어씀' : '등록'}(기존 설정 보존) → ${path}${note}`);
      continue;
    }

    if (client === 'codex' && opts.scope !== 'user') {
      console.error(
        '[codex] 경고: codex는 --scope 미지원 — 전역 ~/.codex/config.toml에 등록됩니다.',
      );
    }
    const { cli, argv } = buildClientCommand(
      client,
      { name: opts.name, scope: opts.scope },
      invocation,
    );
    if (opts.print) {
      console.log(`# ${client}\n${cli} ${argv.join(' ')}`);
      continue;
    }
    if (opts.force) {
      const rm = buildRemoveCommand(client, opts.name, opts.scope);
      runRemove(rm.cli, rm.argv, platform); // 없으면 무시 — 재등록 위한 정리
    }
    const outcome = runDelegated(cli, argv, platform);
    if (outcome === 'ok') {
      console.log(`[${client}] 등록 완료`);
    } else if (outcome === 'already-exists') {
      console.log(
        `[${client}] 이미 등록됨(변경 없음) — 갱신하려면 --force, 또는 별도 창에서 '${cli} mcp remove ${opts.name}' 후 재실행.\n` +
          `  (PowerShell 수동 '${cli} mcp add …'는 .ps1 shim 문제로 -s가 안 먹힐 수 있으니 --force 권장)`,
      );
    } else if (outcome === 'not-installed') {
      console.log(`[${client}] CLI 미설치 — 수동 실행:\n  ${cli} ${argv.join(' ')}`);
    } else {
      console.error(`[${client}] 실패(${outcome}) — 수동 실행:\n  ${cli} ${argv.join(' ')}`);
    }
  }
}
