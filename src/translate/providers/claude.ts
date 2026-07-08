/**
 * @Project: kr-history-bm25
 * @File: claude.ts
 * @Description: Anthropic Claude 번역 provider. @anthropic-ai/sdk를 지연 로드한다(optional dependency).
 * @Author: shyang
 * @LastModified: 2026-07-09
 */
import {
  buildMessages,
  type PassageContext,
  type TranslationProvider,
  type TranslationResult,
} from '../provider';

/** ClaudeProvider 옵션 */
export interface ClaudeProviderOptions {
  /** API 키(미지정 시 ANTHROPIC_API_KEY 사용) */
  apiKey?: string;
  /** 모델 id(미지정 시 KRH_CLAUDE_MODEL 또는 기본값) */
  model?: string;
  /** 최대 출력 토큰 */
  maxTokens?: number;
}

/** Anthropic Claude 직역 provider */
export class ClaudeProvider implements TranslationProvider {
  readonly name = 'claude';

  private readonly apiKey: string;

  private readonly model: string;

  private readonly maxTokens: number;

  // 지연 초기화된 Anthropic 클라이언트
  private client: unknown = null;

  constructor(options: ClaudeProviderOptions = {}) {
    const apiKey = options.apiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY가 필요합니다(하드코딩 금지, env 경유).');
    }
    this.apiKey = apiKey;
    this.model = options.model ?? process.env.KRH_CLAUDE_MODEL ?? 'claude-sonnet-5';
    this.maxTokens = options.maxTokens ?? 2048;
  }

  /** @anthropic-ai/sdk를 지연 로드해 클라이언트를 만든다 */
  private async getClient(): Promise<{
    messages: {
      create(args: unknown): Promise<{ content: Array<{ type: string; text?: string }> }>;
    };
  }> {
    if (this.client === null) {
      let mod: { default: new (opts: { apiKey: string }) => unknown };
      try {
        mod = (await import('@anthropic-ai/sdk')) as unknown as typeof mod;
      } catch {
        throw new Error('@anthropic-ai/sdk 설치가 필요합니다: npm install @anthropic-ai/sdk');
      }
      const Anthropic = mod.default;
      this.client = new Anthropic({ apiKey: this.apiKey });
    }
    return this.client as ReturnType<ClaudeProvider['getClient']> extends Promise<infer T>
      ? T
      : never;
  }

  async translate(han: string, ctx: PassageContext): Promise<TranslationResult> {
    const { system, user } = buildMessages(han, ctx);
    const client = await this.getClient();
    const message = await client.messages.create({
      model: this.model,
      max_tokens: this.maxTokens,
      system,
      messages: [{ role: 'user', content: user }],
    });
    const text = message.content
      .filter((block) => block.type === 'text' && typeof block.text === 'string')
      .map((block) => block.text as string)
      .join('')
      .trim();
    return { text, model: this.model };
  }
}
