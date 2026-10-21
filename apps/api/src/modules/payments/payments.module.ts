import { Global, Module } from '@nestjs/common';
import { InvoicesService } from './invoices.service';
import { MockGatewayController, PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Global()
@Module({
  controllers: [PaymentsController, MockGatewayController],
  providers: [PaymentsService, InvoicesService],
  exports: [PaymentsService, InvoicesService],
})
export class PaymentsModule {}
