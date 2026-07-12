/**
 * @Project: kr-history-bm25
 * @File: install.test.ts
 * @Description: krh mcp install 순수 빌더 단위 테스트 — server invocation(OS 분기)·client argv·gemini config/병합·launcher 전략.
 * @Author: shyang
 * @LastModified: 2026-07-12
 */
import { describe, it, expect } from 'vitest';
import {
  buildServerInvocation,
  buildClientCommand,
  buildGeminiConfig,
  mergeGeminiSettings,
  chooseLauncher,
} from '../../src/mcp/install';
import { PACKAGE_NAME, MCP_BIN } from '../../src/constants';

describe('buildServerInvocation', () => {
  it('기본(posix) — npx 직접, env 없음', () => {
    const inv = buildServerInvocation({ platform: 'linux' });
    expect(inv).toEqual({
      command: 'npx',
      args: ['-y', '-p', PACKAGE_NAME, MCP_BIN],
      env: undefined,
    });
  });

  it('기본(win32) — cmd /d /s /c 래핑(F-02)', () => {
    const inv = buildServerInvocation({ platform: 'win32' });
    expect(inv.command).toBe('cmd');
    expect(inv.args).toEqual(['/d', '/s', '/c', 'npx', '-y', '-p', PACKAGE_NAME, MCP_BIN]);
  });

  it('--global(posix) — krh-mcp 직접', () => {
    const inv = buildServerInvocation({ platform: 'linux', global: true });
    expect(inv).toEqual({ command: MCP_BIN, args: [], env: undefined });
  });

  it('--global(win32) — cmd로 krh-mcp 래핑', () => {
    const inv = buildServerInvocation({ platform: 'win32', global: true });
    expect(inv.args).toEqual(['/d', '/s', '/c', MCP_BIN]);
  });

  it('--db 지정 시 env.KRH_DB 주입', () => {
    const inv = buildServerInvocation({ platform: 'linux', db: '/x/corpus.sqlite' });
    expect(inv.env).toEqual({ KRH_DB: '/x/corpus.sqlite' });
  });
});

describe('buildClientCommand', () => {
  const inv = { command: 'npx', args: ['-y', '-p', PACKAGE_NAME, MCP_BIN] };

  it('claude — -s scope + -- 뒤 invocation', () => {
    const { cli, argv } = buildClientCommand('claude', { name: 'kr-history', scope: 'user' }, inv);
    expect(cli).toBe('claude');
    expect(argv).toEqual([
      'mcp',
      'add',
      'kr-history',
      '-s',
      'user',
      '--',
      'npx',
      '-y',
      '-p',
      PACKAGE_NAME,
      MCP_BIN,
    ]);
  });

  it('codex — scope 플래그 없음', () => {
    const { cli, argv } = buildClientCommand('codex', { name: 'kr-history', scope: 'user' }, inv);
    expect(cli).toBe('codex');
    expect(argv).toEqual([
      'mcp',
      'add',
      'kr-history',
      '--',
      'npx',
      '-y',
      '-p',
      PACKAGE_NAME,
      MCP_BIN,
    ]);
  });

  it('env 있으면 claude=-e / codex=--env', () => {
    const invEnv = { ...inv, env: { KRH_DB: '/x/c.sqlite' } };
    const claude = buildClientCommand('claude', { name: 'kr-history', scope: 'user' }, invEnv).argv;
    const codex = buildClientCommand('codex', { name: 'kr-history', scope: 'user' }, invEnv).argv;
    expect(claude).toContain('-e');
    expect(claude).toContain('KRH_DB=/x/c.sqlite');
    expect(codex).toContain('--env');
    expect(codex).toContain('KRH_DB=/x/c.sqlite');
  });
});

describe('buildGeminiConfig', () => {
  it('command/args + env', () => {
    const cfg = buildGeminiConfig({ command: 'npx', args: ['-y'], env: { KRH_DB: '/x' } });
    expect(cfg).toEqual({ command: 'npx', args: ['-y'], env: { KRH_DB: '/x' } });
  });

  it('env 없으면 env 키 생략', () => {
    const cfg = buildGeminiConfig({ command: 'npx', args: ['-y'] });
    expect(cfg).toEqual({ command: 'npx', args: ['-y'] });
  });
});

describe('mergeGeminiSettings — 기존 키 보존', () => {
  it('빈 파일에 신규 등록', () => {
    const { json, overwritten } = mergeGeminiSettings(null, 'kr-history', { command: 'npx' });
    expect(overwritten).toBe(false);
    expect(JSON.parse(json)).toEqual({ mcpServers: { 'kr-history': { command: 'npx' } } });
  });

  it('기존 mcpServers·타 최상위 설정 보존', () => {
    const existing = JSON.stringify({
      theme: 'dark',
      mcpServers: { other: { command: 'foo' } },
    });
    const { json } = mergeGeminiSettings(existing, 'kr-history', { command: 'npx' });
    const parsed = JSON.parse(json) as Record<string, unknown>;
    expect(parsed.theme).toBe('dark');
    expect((parsed.mcpServers as Record<string, unknown>).other).toEqual({ command: 'foo' });
    expect((parsed.mcpServers as Record<string, unknown>)['kr-history']).toEqual({
      command: 'npx',
    });
  });

  it('동일 name 재등록 → overwritten=true', () => {
    const existing = JSON.stringify({ mcpServers: { 'kr-history': { command: 'old' } } });
    const { overwritten } = mergeGeminiSettings(existing, 'kr-history', { command: 'npx' });
    expect(overwritten).toBe(true);
  });
});

describe('chooseLauncher (F-01)', () => {
  it('posix — 첫 후보 직접', () => {
    expect(chooseLauncher(['/usr/bin/claude'], 'linux')).toEqual({
      command: '/usr/bin/claude',
      prefixArgs: [],
    });
  });

  it('win32 — .exe 직접', () => {
    expect(chooseLauncher(['C:\\x\\claude.exe'], 'win32')).toEqual({
      command: 'C:\\x\\claude.exe',
      prefixArgs: [],
    });
  });

  it('win32 — .cmd는 cmd.exe /d /s /c 래핑', () => {
    expect(chooseLauncher(['C:\\x\\npx.cmd'], 'win32')).toEqual({
      command: 'cmd.exe',
      prefixArgs: ['/d', '/s', '/c', 'C:\\x\\npx.cmd'],
    });
  });

  it('win32 — shim(확장자 없음) + .cmd 혼재 시 .cmd 선택', () => {
    const r = chooseLauncher(['C:\\x\\npx', 'C:\\x\\npx.cmd'], 'win32');
    expect(r).toEqual({ command: 'cmd.exe', prefixArgs: ['/d', '/s', '/c', 'C:\\x\\npx.cmd'] });
  });

  it('win32 — 확장자 없는 shim만이면 null(직접 spawn 불가)', () => {
    expect(chooseLauncher(['C:\\x\\npx'], 'win32')).toBeNull();
  });

  it('빈 후보 → null', () => {
    expect(chooseLauncher([], 'win32')).toBeNull();
  });
});
