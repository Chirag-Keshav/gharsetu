/**
 * AiProvider adapter (SPEC §5, §8.11). AI is advisory: providers only return text, never act.
 * Model IDs come from the environment, never from code.
 */
import Anthropic from '@anthropic-ai/sdk';
import { jsonSchemaOutputFormat } from '@anthropic-ai/sdk/helpers/json-schema';
import type { AiFeatureKey } from '@propcare/shared';

export type AiTier = 'fast' | 'smart';

export interface AiImage {
  mediaType: 'image/jpeg' | 'image/png' | 'image/webp';
  base64: string;
}

export interface AiRequest {
  featureKey: AiFeatureKey;
  tier: AiTier;
  system: string;
  /** Prompt body with untrusted content already delimited and redacted. */
  userText: string;
  images?: AiImage[];
  /** JSON schema of the expected output (derived from the shared zod schema). */
  jsonSchema: Record<string, unknown>;
  maxTokens: number;
  timeoutMs: number;
  /** The redacted, allow-listed context object (used by the mock provider and by tests). */
  context: Record<string, unknown>;
}

export interface AiResponse {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  /** The model declined (stop_reason "refusal"); treated as a failed suggestion. */
  refused?: boolean;
}

export interface AiProvider {
  readonly name: string;
  complete(req: AiRequest): Promise<AiResponse>;
}

export const AI_PROVIDER = Symbol('AI_PROVIDER');

export interface AnthropicOptions {
  apiKey: string;
  fastModel: string;
  smartModel: string;
  /** Tiers that request the server-side refusal fallback (not every model supports it). */
  fallbackTiers: AiTier[];
}

export class AnthropicAiProvider implements AiProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(private readonly opts: AnthropicOptions) {
    this.client = new Anthropic({ apiKey: opts.apiKey, maxRetries: 1 });
  }

  async complete(req: AiRequest): Promise<AiResponse> {
    const model = req.tier === 'smart' ? this.opts.smartModel : this.opts.fastModel;
    const content: Anthropic.Beta.BetaContentBlockParam[] = [
      ...(req.images ?? []).map(
        (img): Anthropic.Beta.BetaImageBlockParam => ({
          type: 'image',
          source: { type: 'base64', media_type: img.mediaType, data: img.base64 },
        }),
      ),
      { type: 'text', text: req.userText },
    ];
    const withFallback = this.opts.fallbackTiers.includes(req.tier);
    // The helper converts the schema to the structured-output subset; our zod schema stays the
    // authoritative validator of the returned text.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- runtime JSON schema, not a literal type
    const format = jsonSchemaOutputFormat(req.jsonSchema as any);
    const response = await this.client.beta.messages.create(
      {
        model,
        max_tokens: req.maxTokens,
        system: req.system,
        messages: [{ role: 'user', content }],
        output_config: { effort: req.tier === 'smart' ? 'medium' : 'low', format },
        ...(withFallback ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {}),
      },
      { timeout: req.timeoutMs },
    );
    const text = response.content
      .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('');
    return {
      text,
      model: response.model,
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      refused: response.stop_reason === 'refusal',
    };
  }
}

export type MockGenerator = (context: Record<string, unknown>) => unknown;

/**
 * Deterministic offline provider for development, CI and evals. It records every request so
 * redaction tests can assert on exactly what would have left the system.
 */
export class MockAiProvider implements AiProvider {
  readonly name = 'mock';
  readonly received: AiRequest[] = [];
  /** Tests can force failures or slow responses. */
  behaviour: 'normal' | 'fail' | 'hang' | 'invalid' = 'normal';

  constructor(private readonly generators: Partial<Record<AiFeatureKey, MockGenerator>>) {}

  async complete(req: AiRequest): Promise<AiResponse> {
    this.received.push(req);
    if (this.received.length > 500) this.received.shift();
    if (this.behaviour === 'fail') throw new Error('mock provider failure');
    if (this.behaviour === 'hang') await new Promise((r) => setTimeout(r, req.timeoutMs + 1000));
    if (this.behaviour === 'invalid') return { text: '{"unexpected": true', model: 'mock', inputTokens: 1, outputTokens: 1 };
    const gen = this.generators[req.featureKey];
    const output = gen ? gen(req.context) : {};
    const text = JSON.stringify(output);
    return { text, model: 'mock', inputTokens: Math.ceil(req.userText.length / 4), outputTokens: Math.ceil(text.length / 4) };
  }
}
