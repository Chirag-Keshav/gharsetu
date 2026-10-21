import { Module } from '@nestjs/common';
import { AuthController, MeController, OwnerProfileController } from './auth.controller';
import { AuthService } from './auth.service';

@Module({
  controllers: [AuthController, MeController, OwnerProfileController],
  providers: [AuthService],
  exports: [AuthService],
})
export class AuthModule {}
