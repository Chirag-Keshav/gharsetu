import { Body, Controller, Get, Global, HttpCode, Module, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { aiActionSchema, aiSuggestSchema, nlSearchSchema } from '@propcare/shared';
import { z } from 'zod';
import { AI_PROVIDER, AnthropicAiProvider, MockAiProvider } from '../../adapters/ai';
import { ENV, type Env } from '../../config/env';
import { CurrentActor, Flags, Public, RateLimit, Roles, SYSTEM_ACTOR, type UserActor } from '../../core/context';
import { AppError } from '../../core/errors';
import { zp } from '../../core/zod.pipe';
import { MetricsService } from '../reports/metrics.service';
import { AiService } from './ai.service';
import { MOCK_GENERATORS } from './mock-generators';

const subjectQuery = z.object({ subjectType: z.string().max(40), subjectId: z.string().uuid() });

@Controller()
export class AiController {
  constructor(private readonly ai: AiService) {}

  @Get('ai/status')
  status(@CurrentActor() a: UserActor) {
    return this.ai.status(a);
  }

  @RateLimit({ bucket: 'ai', limit: 60, windowMs: 60_000 })
  @Post('ai/suggestions')
  suggest(@CurrentActor() a: UserActor, @Body(zp(aiSuggestSchema)) body: z.infer<typeof aiSuggestSchema>) {
    return this.ai.suggest(a, body.featureKey, body.subjectId, body.params);
  }

  @Get('ai/suggestions')
  forSubject(@CurrentActor() a: UserActor, @Query(zp(subjectQuery)) q: z.infer<typeof subjectQuery>) {
    return this.ai.listForSubject(a, q.subjectType, q.subjectId);
  }

  @Get('ai/suggestions/:id')
  get(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.ai.get(a, id);
  }

  @Post('ai/suggestions/:id/accept')
  @HttpCode(200)
  accept(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(aiActionSchema)) body: z.infer<typeof aiActionSchema>) {
    return this.ai.act(a, id, 'ACCEPTED', body.feedback);
  }

  @Post('ai/suggestions/:id/edit')
  @HttpCode(200)
  edit(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(aiActionSchema)) body: z.infer<typeof aiActionSchema>) {
    return this.ai.act(a, id, 'EDITED', body.feedback);
  }

  @Post('ai/suggestions/:id/dismiss')
  @HttpCode(200)
  dismiss(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(aiActionSchema)) body: z.infer<typeof aiActionSchema>) {
    return this.ai.act(a, id, 'DISMISSED', body.feedback);
  }

  @Roles('ADMIN')
  @Get('admin/ai/briefing')
  briefing(@CurrentActor() a: UserActor) {
    return this.ai.briefing(a);
  }

  @Roles('ADMIN')
  @Post('admin/ai/briefing/refresh')
  @HttpCode(200)
  refresh(@CurrentActor() a: UserActor) {
    return this.ai.refreshBriefing(a);
  }

  @Roles('ADMIN')
  @Flags('AI_ADMIN')
  @Get('admin/ai/usage')
  usage() {
    return this.ai.usage();
  }

  /** Natural-language search → editable filter chips; search itself stays deterministic (AI-CUS-01). */
  @Public()
  @RateLimit({ bucket: 'search-parse', limit: 20, windowMs: 60_000 })
  @Post('search/parse')
  @HttpCode(200)
  async parse(@Body(zp(nlSearchSchema)) body: z.infer<typeof nlSearchSchema>) {
    const s = await this.ai.suggest(SYSTEM_ACTOR, 'nl_search', undefined, { query: body.query }, { wait: true });
    if (s.status === 'FAILED' || !s.output) throw new AppError('AI_UNAVAILABLE');
    return { suggestionId: s.id, filters: s.output, label: s.label };
  }
}

@Global()
@Module({
  controllers: [AiController],
  providers: [
    AiService,
    MetricsService,
    {
      provide: AI_PROVIDER,
      inject: [ENV],
      useFactory: (env: Env) =>
        env.AI_PROVIDER === 'anthropic' && env.ANTHROPIC_API_KEY
          ? new AnthropicAiProvider({
              apiKey: env.ANTHROPIC_API_KEY,
              fastModel: env.AI_MODEL_FAST!,
              smartModel: env.AI_MODEL_SMART!,
              fallbackTiers: env.AI_REFUSAL_FALLBACK === 'all' ? ['fast', 'smart'] : env.AI_REFUSAL_FALLBACK === 'smart' ? ['smart'] : [],
            })
          : new MockAiProvider(MOCK_GENERATORS),
    },
  ],
  exports: [AiService, MetricsService, AI_PROVIDER],
})
export class AiModule {}
