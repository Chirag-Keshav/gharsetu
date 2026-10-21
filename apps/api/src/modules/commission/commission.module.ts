import { Global, Module } from '@nestjs/common';
import { AdminCommissionController, OwnerCommissionController } from './commission.controller';
import { CommissionService } from './commission.service';

@Global()
@Module({
  controllers: [AdminCommissionController, OwnerCommissionController],
  providers: [CommissionService],
  exports: [CommissionService],
})
export class CommissionModule {}
