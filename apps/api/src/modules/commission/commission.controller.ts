import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { BENCHMARK_MODES, benchmarkSchema, benchmarkUpdateSchema, commissionOverrideSchema, UNDERCUT_MODES } from '@propcare/shared';
import { z } from 'zod';
import { CurrentActor, Flags, Roles, type UserActor } from '../../core/context';
import { zp } from '../../core/zod.pipe';
import { CommissionService } from './commission.service';

const settingsSchema = z
  .object({
    benchmarkMode: z.enum(BENCHMARK_MODES),
    specificBenchmarkId: z.string().uuid().nullable(),
    undercutMode: z.enum(UNDERCUT_MODES),
    undercutBps: z.coerce.number().int().min(0).max(10_000),
    floorBps: z.coerce.number().int().min(0).max(10_000),
    ceilingBps: z.coerce.number().int().min(0).max(10_000),
  })
  .partial();

@Controller('admin')
@Roles('ADMIN')
@Flags('FINANCE')
export class AdminCommissionController {
  constructor(private readonly commission: CommissionService) {}

  @Get('commission-benchmarks')
  list() {
    return this.commission.benchmarks();
  }

  @Post('commission-benchmarks')
  create(@CurrentActor() a: UserActor, @Body(zp(benchmarkSchema)) body: z.infer<typeof benchmarkSchema>) {
    return this.commission.createBenchmark(a, body);
  }

  @Patch('commission-benchmarks/:id')
  update(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(benchmarkUpdateSchema)) body: z.infer<typeof benchmarkUpdateSchema>) {
    return this.commission.updateBenchmark(a, id, body);
  }

  /** Preview: pass proposed settings as query params to see the rate before saving. */
  @Get('commission/effective')
  effective(@Query(zp(settingsSchema)) q: z.infer<typeof settingsSchema>) {
    return this.commission.preview(q);
  }

  @Put('commission/settings')
  settings(@CurrentActor() a: UserActor, @Body(zp(settingsSchema)) body: z.infer<typeof settingsSchema>) {
    return this.commission.updateSettings(a, body);
  }

  @Put('owners/:id/commission-override')
  override(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(commissionOverrideSchema)) body: z.infer<typeof commissionOverrideSchema>) {
    return this.commission.setOwnerOverride(a, id, body.bps, body.reason);
  }
}

@Controller('owner/commission')
@Roles('OWNER')
export class OwnerCommissionController {
  constructor(private readonly commission: CommissionService) {}

  @Get()
  get(@CurrentActor() a: UserActor) {
    return this.commission.ownerView(a.userId);
  }
}
