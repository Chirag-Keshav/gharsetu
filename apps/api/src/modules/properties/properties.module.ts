import { Module } from '@nestjs/common';
import { AdminVerificationsController, PropertiesController } from './properties.controller';
import { PropertiesService } from './properties.service';
import { VerificationsService } from './verifications.service';

@Module({
  controllers: [PropertiesController, AdminVerificationsController],
  providers: [PropertiesService, VerificationsService],
  exports: [PropertiesService],
})
export class PropertiesModule {}
