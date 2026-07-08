/**
 * @Project: kr-history-bm25
 * @File: codex.ts
 * @Description: OpenAI 호환 chat completions 번역 provider(Codex/OpenAI/로컬 등). base URL·모델 교체형, fetch 기반.
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import {
  buildMessages,
  type PassageContext,
  type TranslationProvider,
  type TranslationResult,
} from '../provider';

/** CodexProvider 옵션 */
export interface CodexProviderOptions {
  /** API 키(미지정 시 OPENAI_API_KEY) */
  apiKey?: string;
  /** base URL(미지정 시 CODEX_BASE_URL 또는 OpenAI 기본) */
  baseUrl?: string;
  /** 모델(미지정 시 CODEX_MODEL 또는 기본값) */
  model?: string;
}

/** OpenAI 호환 chat completions 직역 provider */
export class CodexProvider implements TranslationProvider {
  readonly name = 'codex';

  private readonly apiKey: string;

  private readonly baseUrl: string;

  private readonly model: string;

  constructor(options: CodexProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY가 필요합니다(env 경유).');
    }
    this.apiKey = apiKey;
    this.baseUrl = options.baseUrl ?? process.env.CODEX_BASE_URL ?? 'https://api.openai.com/v1';
    this.model = options.model ?? process.env.CODEX_MODEL ?? 'gpt-4o-mini';
  }

  async translate(han: string, ctx: PassageContext): Promise<TranslationResult> {
    const { system, user } = buildMessages(han, ctx);
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: user },
        ],
      }),
    });
    if (!response.ok) {
      throw new Error(`OpenAI 호환 API 오류 ${response.status}: ${await response.text()}`);
    }
    const body = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const text = (body.choices?.[0]?.message?.content ?? '').trim();
    return { text, model: this.model };
  }
}
