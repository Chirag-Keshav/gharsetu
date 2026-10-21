import { Controller, Get, HttpException, HttpStatus } from '@nestjs/common';
import { Public } from '../../core/context';
import { PrismaService } from '../../core/prisma.service';

/** Liveness and readiness (SPEC §12.8); responses carry no system detail. */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Public()
  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new HttpException({ status: 'unavailable' }, HttpStatus.SERVICE_UNAVAILABLE);
    }
  }
}
