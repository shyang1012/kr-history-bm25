/**
 * @Project: kr-history-bm25
 * @File: cloudflare.ts
 * @Description: Cloudflare Workers AI 번역 provider. REST API(fetch)로 호출한다(추가 의존성 없음).
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import {
  buildMessages,
  type PassageContext,
  type TranslationProvider,
  type TranslationResult,
} from '../provider';

/** CloudflareProvider 옵션 */
export interface CloudflareProviderOptions {
  /** 계정 id(미지정 시 CF_ACCOUNT_ID) */
  accountId?: string;
  /** API 토큰(미지정 시 CF_API_TOKEN) */
  apiToken?: string;
  /** 모델(미지정 시 CF_MODEL 또는 기본값) */
  model?: string;
}

/** Cloudflare Workers AI 직역 provider */
export class CloudflareProvider implements TranslationProvider {
  readonly name = 'cloudflare';

  private readonly accountId: string;

  private readonly apiToken: string;

  private readonly model: string;

  constructor(options: CloudflareProviderOptions = {}) {
    const accountId = options.accountId ?? process.env.CF_ACCOUNT_ID;
    const apiToken = options.apiToken ?? process.env.CF_API_TOKEN;
    if (!accountId || !apiToken) {
      throw new Error('CF_ACCOUNT_ID와 CF_API_TOKEN이 필요합니다(env 경유).');
    }
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.model = options.model ?? process.env.CF_MODEL ?? '@cf/meta/llama-3.1-8b-instruct';
  }

  async translate(han: string, ctx: PassageContext): Promise<TranslationResult> {
    const { system, user } = buildMessages(han, ctx);
    const url = `https://api.cloudflare.com/client/v4/accounts/${this.accountId}/ai/run/${this.model}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`Cloudflare AI 오류 ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as { result?: { response?: string } };
    const text = (body.result?.response ?? '').trim();
    return { text, model: this.model };
  }
}
