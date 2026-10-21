import { Global, Module } from '@nestjs/common';
import { ThreadsService } from '../threads/threads.service';
import { AttachmentsController, LocalStorageController } from './attachments.controller';
import { AttachmentsService } from './attachments.service';

@Global()
@Module({
  controllers: [AttachmentsController, LocalStorageController],
  providers: [AttachmentsService, ThreadsService],
  exports: [AttachmentsService, ThreadsService],
})
export class AttachmentsModule {}
