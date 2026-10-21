import { Global, Module } from '@nestjs/common';
import { ProvidersController, RequestsController, WorkOrdersController } from './maintenance.controller';
import { ProvidersService } from './providers.service';
import { QuotesService } from './quotes.service';
import { RequestsService } from './requests.service';
import { RequirementsService } from './requirements.service';
import { WorkOrdersService } from './work-orders.service';

@Global()
@Module({
  controllers: [RequestsController, WorkOrdersController, ProvidersController],
  providers: [RequestsService, QuotesService, WorkOrdersService, ProvidersService, RequirementsService],
  exports: [RequestsService, QuotesService, WorkOrdersService, ProvidersService],
})
export class MaintenanceModule {}
