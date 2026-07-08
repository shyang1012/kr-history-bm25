/**
 * @Project: kr-history-bm25
 * @File: create-provider.ts
 * @Description: provider 이름 → TranslationProvider 인스턴스 팩토리. env 자격증명을 사용한다.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import type { TranslationProvider } from './provider';
import { ClaudeProvider } from './providers/claude';
import { CloudflareProvider } from './providers/cloudflare';
import { CodexProvider } from './providers/codex';

/** 지원 provider 이름 */
export type ProviderName = 'claude' | 'cloudflare' | 'codex';

/**
 * provider 이름으로 인스턴스를 만든다.
 * @param name - provider 이름
 * @returns TranslationProvider 인스턴스
 */
export function createProvider(name: ProviderName): TranslationProvider {
  switch (name) {
    case 'claude':
      return new ClaudeProvider();
    case 'cloudflare':
      return new CloudflareProvider();
    case 'codex':
      return new CodexProvider();
    default:
      throw new Error(`알 수 없는 provider: ${name as string}`);
  }
}
