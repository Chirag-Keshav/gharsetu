import { Body, Controller, Delete, Get, Header, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import {
  adminListingQuery,
  calendarBlockSchema,
  calendarQuery,
  isoDate,
  listingAmenitiesSchema,
  listingDecisionSchema,
  listingPhotoAddSchema,
  listingPhotoOrderSchema,
  listingPhotoUpdateSchema,
  listingUpdateSchema,
  paginationQuery,
  priceQuoteSchema,
  priceRuleSchema,
  searchQuerySchema,
} from '@propcare/shared';
import { z } from 'zod';
import { CurrentActor, Flags, Public, RateLimit, Roles, type UserActor } from '../../core/context';
import { zp } from '../../core/zod.pipe';
import { ThreadsService } from '../threads/threads.service';
import { ListingReviewService } from './listing-review.service';
import { ListingsService } from './listings.service';
import { PublicService } from './public.service';

const PUBLIC_LIMIT = { bucket: 'public', limit: 180, windowMs: 60_000 };

@Controller()
@Roles('OWNER', 'ADMIN')
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly threads: ThreadsService,
  ) {}

  @Post('properties/:id/listing')
  create(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) propertyId: string) {
    return this.listings.create(a, propertyId);
  }

  @Get('listings/:id')
  get(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.view(a, id);
  }

  @Patch('listings/:id')
  update(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(listingUpdateSchema)) body: z.infer<typeof listingUpdateSchema>) {
    return this.listings.update(a, id, body);
  }

  @Put('listings/:id/amenities')
  amenities(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(listingAmenitiesSchema)) body: z.infer<typeof listingAmenitiesSchema>) {
    return this.listings.setAmenities(a, id, body.amenityIds);
  }

  @Post('listings/:id/photos')
  addPhoto(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(listingPhotoAddSchema)) body: z.infer<typeof listingPhotoAddSchema>) {
    return this.listings.addPhoto(a, id, body.attachmentId, body.caption);
  }

  @Put('listings/:id/photos/order')
  order(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(listingPhotoOrderSchema)) body: z.infer<typeof listingPhotoOrderSchema>) {
    return this.listings.reorderPhotos(a, id, body.photoIds);
  }

  @Patch('listings/:id/photos/:photoId')
  updatePhoto(
    @CurrentActor() a: UserActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('photoId', ParseUUIDPipe) photoId: string,
    @Body(zp(listingPhotoUpdateSchema)) body: z.infer<typeof listingPhotoUpdateSchema>,
  ) {
    return this.listings.updatePhoto(a, id, photoId, body);
  }

  @Delete('listings/:id/photos/:photoId')
  removePhoto(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Param('photoId', ParseUUIDPipe) photoId: string) {
    return this.listings.removePhoto(a, id, photoId);
  }

  @Roles('OWNER')
  @Post('listings/:id/submit')
  @HttpCode(200)
  submit(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.submit(a, id);
  }

  @Roles('OWNER')
  @Post('listings/:id/pause')
  @HttpCode(200)
  pause(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.pause(a, id);
  }

  @Roles('OWNER')
  @Post('listings/:id/resume')
  @HttpCode(200)
  resume(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.resume(a, id);
  }

  @Post('listings/:id/archive')
  @HttpCode(200)
  archive(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.archive(a, id);
  }

  @Get('listings/:id/calendar')
  calendar(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Query(zp(calendarQuery)) q: z.infer<typeof calendarQuery>) {
    return this.listings.calendar(a, id, q.from, q.to);
  }

  @Post('listings/:id/blocks')
  block(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(calendarBlockSchema)) body: z.infer<typeof calendarBlockSchema>) {
    return this.listings.addBlock(a, id, body);
  }

  @Delete('listings/:id/blocks/:blockId')
  unblock(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Param('blockId', ParseUUIDPipe) blockId: string) {
    return this.listings.removeBlock(a, id, blockId);
  }

  @Get('listings/:id/price-rules')
  priceRules(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.priceRules(a, id);
  }

  @Post('listings/:id/price-rules')
  addPriceRule(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(priceRuleSchema)) body: z.infer<typeof priceRuleSchema>) {
    return this.listings.upsertPriceRule(a, id, null, body);
  }

  @Patch('listings/:id/price-rules/:ruleId')
  updatePriceRule(
    @CurrentActor() a: UserActor,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('ruleId', ParseUUIDPipe) ruleId: string,
    @Body(zp(priceRuleSchema)) body: z.infer<typeof priceRuleSchema>,
  ) {
    return this.listings.upsertPriceRule(a, id, ruleId, body);
  }

  @Delete('listings/:id/price-rules/:ruleId')
  deletePriceRule(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Param('ruleId', ParseUUIDPipe) ruleId: string) {
    return this.listings.deletePriceRule(a, id, ruleId);
  }

  @Get('listings/:id/earnings')
  earnings(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.listings.earnings(a, id);
  }

  @Get('listings/:id/review-messages')
  reviewMessages(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.threads.list(a, 'LISTING_REVIEW', id);
  }
}

@Controller('admin/listings')
@Roles('ADMIN')
export class AdminListingsController {
  constructor(private readonly review: ListingReviewService) {}

  @Get()
  queue(@Query(zp(adminListingQuery)) q: z.infer<typeof adminListingQuery>) {
    return this.review.queue(q.status, q.edited, q.cursor, q.limit);
  }

  @Get(':id')
  workspace(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.workspace(a, id);
  }

  @Flags('LISTING_REVIEW')
  @Post(':id/request-changes')
  @HttpCode(200)
  requestChanges(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(listingDecisionSchema)) body: z.infer<typeof listingDecisionSchema>) {
    return this.review.requestChanges(a, id, body.message);
  }

  @Flags('LISTING_REVIEW')
  @Post(':id/publish')
  @HttpCode(200)
  publish(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.publish(a, id);
  }

  @Flags('LISTING_REVIEW')
  @Post(':id/reject')
  @HttpCode(200)
  reject(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(listingDecisionSchema)) body: z.infer<typeof listingDecisionSchema>) {
    return this.review.reject(a, id, body.message);
  }

  @Flags('LISTING_REVIEW')
  @Post(':id/pause')
  @HttpCode(200)
  pause(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string, @Body(zp(listingDecisionSchema.partial())) body: { message?: string }) {
    return this.review.pause(a, id, body.message ?? null);
  }

  @Flags('LISTING_REVIEW')
  @Post(':id/resume')
  @HttpCode(200)
  resume(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.resume(a, id);
  }

  @Flags('LISTING_REVIEW')
  @Post(':id/mark-reviewed')
  @HttpCode(200)
  markReviewed(@CurrentActor() a: UserActor, @Param('id', ParseUUIDPipe) id: string) {
    return this.review.markReviewed(a, id);
  }
}

const availabilityQuery = z.object({ from: isoDate.optional(), to: isoDate.optional() });

/** Public discovery — no session is read on any of these routes (SPEC §12.9). */
@Controller('public')
export class PublicController {
  constructor(private readonly publicService: PublicService) {}

  @Public()
  @RateLimit(PUBLIC_LIMIT)
  @Header('Cache-Control', 'public, max-age=30')
  @Get('listings')
  search(@Query(zp(searchQuerySchema)) q: z.infer<typeof searchQuerySchema>) {
    return this.publicService.search(q);
  }

  @Public()
  @RateLimit(PUBLIC_LIMIT)
  @Header('Cache-Control', 'public, max-age=60')
  @Get('listings/:id')
  detail(@Param('id', ParseUUIDPipe) id: string) {
    return this.publicService.detail(id);
  }

  @Public()
  @RateLimit(PUBLIC_LIMIT)
  @Get('listings/:id/availability')
  availability(@Param('id', ParseUUIDPipe) id: string, @Query(zp(availabilityQuery)) q: z.infer<typeof availabilityQuery>) {
    return this.publicService.availability(id, q.from, q.to);
  }

  @Public()
  @RateLimit({ bucket: 'price-quote', limit: 120, windowMs: 60_000 })
  @Post('listings/:id/price-quote')
  @HttpCode(200)
  quote(@Param('id', ParseUUIDPipe) id: string, @Body(zp(priceQuoteSchema)) body: z.infer<typeof priceQuoteSchema>) {
    return this.publicService.priceQuote(id, body);
  }

  @Public()
  @RateLimit(PUBLIC_LIMIT)
  @Get('listings/:id/reviews')
  reviews(@Param('id', ParseUUIDPipe) id: string, @Query(zp(paginationQuery)) q: z.infer<typeof paginationQuery>) {
    return this.publicService.reviews(id, q.cursor, Math.min(q.limit, 50));
  }

  @Public()
  @RateLimit(PUBLIC_LIMIT)
  @Get('locations/suggest')
  suggest(@Query('q') q = '') {
    return this.publicService.suggest(String(q).slice(0, 60));
  }
}
