import { Global, Module } from '@nestjs/common';
import { ListingMediaService } from './listing-media.service';
import { ListingReviewService } from './listing-review.service';
import { AdminListingsController, ListingsController, PublicController } from './listings.controller';
import { ListingsService } from './listings.service';
import { OccupancyService } from './occupancy.service';
import { PublicService } from './public.service';
import { StayPricingService } from './stay-pricing.service';

@Global()
@Module({
  controllers: [ListingsController, AdminListingsController, PublicController],
  providers: [ListingsService, ListingReviewService, ListingMediaService, OccupancyService, StayPricingService, PublicService],
  exports: [ListingsService, ListingMediaService, OccupancyService, StayPricingService, PublicService, ListingReviewService],
})
export class ListingsModule {}
