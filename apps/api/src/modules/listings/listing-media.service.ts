import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import sharp from 'sharp';
import { OBJECT_STORAGE, type ObjectStorage } from '../../adapters/storage';
import { errorFields, log } from '../../core/logger';
import { PrismaService } from '../../core/prisma.service';
import type { PublicVariants } from './listing-serializers';

const SIZES = { sm: 480, lg: 1280 } as const;

/**
 * Public photo pipeline (SPEC §8.3 LST-03, §14.1). Listing photos are the only media that may
 * ever be public, and only while the listing is PUBLISHED. Variants are re-encoded with sharp,
 * which drops all EXIF/XMP metadata (including GPS) unless explicitly asked to keep it.
 */
@Injectable()
export class ListingMediaService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  private keys(listingId: string, photoId: string) {
    return { sm: `listings/${listingId}/${photoId}-sm.webp`, lg: `listings/${listingId}/${photoId}-lg.webp` };
  }

  /** Publishes or removes public variants so they match the listing status. Idempotent. */
  async sync(listingId: string): Promise<void> {
    const listing = await this.prisma.listing.findUnique({ where: { id: listingId }, include: { photos: { include: { attachment: true } } } });
    if (!listing) return;
    const shouldBePublic = listing.status === 'PUBLISHED';
    for (const photo of listing.photos) {
      if (!shouldBePublic) {
        if (photo.publicVariants) await this.removeVariants(listingId, photo.id);
        continue;
      }
      if (photo.publicVariants) continue;
      try {
        const original = await this.storage.get('private', photo.attachment.objectKey);
        if (!original) continue;
        const variants: Partial<PublicVariants> = {};
        for (const [size, width] of Object.entries(SIZES) as Array<[keyof typeof SIZES, number]>) {
          const { data, info } = await sharp(original)
            .rotate() // apply EXIF orientation before metadata is discarded
            .resize({ width, withoutEnlargement: true })
            .webp({ quality: 80 })
            .toBuffer({ resolveWithObject: true });
          const key = this.keys(listingId, photo.id)[size];
          await this.storage.put('public', key, data, 'image/webp');
          variants[size] = { url: this.storage.publicUrl(key), width: info.width, height: info.height };
        }
        await this.prisma.listingPhoto.update({
          where: { id: photo.id },
          data: { publicVariants: variants as unknown as Prisma.InputJsonValue },
        });
      } catch (err) {
        log.warn('listing_variant_failed', { listingId, photoId: photo.id, ...errorFields(err) });
      }
    }
  }

  async removeVariants(listingId: string, photoId: string): Promise<void> {
    const keys = this.keys(listingId, photoId);
    await Promise.all([this.storage.delete('public', keys.sm), this.storage.delete('public', keys.lg)]);
    await this.prisma.listingPhoto.updateMany({ where: { id: photoId }, data: { publicVariants: Prisma.DbNull } });
  }
}
