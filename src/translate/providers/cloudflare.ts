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
  /** 계정 id(미지정 시 CF_ACCOUNT_ID 또는 CLOUDFLARE_ACCOUNT_ID) */
  accountId?: string;
  /** API 토큰(미지정 시 CF_API_TOKEN 또는 CLOUDFLARE_API_TOKEN) */
  apiToken?: string;
  /** 모델(미지정 시 CF_MODEL 또는 기본값) */
  model?: string;
  /** 최대 출력 토큰(기본 2048) */
  maxTokens?: number;
  /** 샘플링 온도. 직역 충실성을 위해 낮게 유지(기본 0.2) */
  temperature?: number;
}

/** Cloudflare Workers AI 직역 provider */
export class CloudflareProvider implements TranslationProvider {
  readonly name = 'cloudflare';

  private readonly accountId: string;

  private readonly apiToken: string;

  private readonly model: string;

  private readonly maxTokens: number;

  private readonly temperature: number;

  constructor(options: CloudflareProviderOptions = {}) {
    const accountId =
      options.accountId ?? process.env.CF_ACCOUNT_ID ?? process.env.CLOUDFLARE_ACCOUNT_ID;
    const apiToken =
      options.apiToken ?? process.env.CF_API_TOKEN ?? process.env.CLOUDFLARE_API_TOKEN;
    if (!accountId || !apiToken) {
      throw new Error(
        'CF 계정/토큰이 필요합니다(env: CF_ACCOUNT_ID·CF_API_TOKEN 또는 CLOUDFLARE_ACCOUNT_ID·CLOUDFLARE_API_TOKEN).',
      );
    }
    this.accountId = accountId;
    this.apiToken = apiToken;
    this.model = options.model ?? process.env.CF_MODEL ?? '@cf/google/gemma-4-26b-a4b-it';
    // reasoning 모델은 사고과정이 출력 토큰을 크게 소비하므로 여유 있게 잡는다(CF_MAX_TOKENS로 상향 가능).
    this.maxTokens = options.maxTokens ?? Number(process.env.CF_MAX_TOKENS ?? 4096);
    this.temperature = options.temperature ?? 0.2;
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
        max_tokens: this.maxTokens,
        temperature: this.temperature,
      }),
    });
    if (!response.ok) {
      throw new Error(`Cloudflare AI 오류 ${response.status}: ${await response.text()}`);
    }
    // /ai/run 응답은 OpenAI 호환(choices[0].message.content) 또는 단순(result.response) 두 형태를 가진다.
    const body = (await response.json()) as {
      result?: {
        response?: string;
        choices?: Array<{ message?: { content?: string } }>;
      };
    };
    const openaiText = body.result?.choices?.[0]?.message?.content;
    const text = (openaiText ?? body.result?.response ?? '').trim();
    return { text, model: this.model };
  }
}
