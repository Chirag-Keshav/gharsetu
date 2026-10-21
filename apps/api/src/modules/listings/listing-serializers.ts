/**
 * Audience-specific listing serializers (SPEC §7 rule 10, §12.9). The public view never contains
 * the exact address, access/check-in instructions or owner contact details.
 */
import type { Amenity, Listing, ListingPhoto, Property } from '@prisma/client';
import { houseRulesSchema, type HouseRules } from '@propcare/shared';
import { iso, num } from '../../core/serialize';

export interface PublicVariants {
  sm: { url: string; width: number; height: number };
  lg: { url: string; width: number; height: number };
}

export type ListingWith = Listing & {
  photos?: ListingPhoto[];
  amenities?: Array<{ amenity: Amenity }>;
  property?: Pick<Property, 'propertyType' | 'city' | 'district' | 'state'> & Partial<Property>;
};

export function houseRulesOf(l: Listing): HouseRules {
  const parsed = houseRulesSchema.safeParse(l.houseRules ?? {});
  return parsed.success ? parsed.data : houseRulesSchema.parse({});
}

export function publicPhotos(photos: ListingPhoto[] = []) {
  return [...photos]
    .sort((a, b) => Number(b.isCover) - Number(a.isCover) || a.position - b.position)
    .filter((p) => p.publicVariants)
    .map((p) => ({ id: p.id, caption: p.caption, isCover: p.isCover, variants: p.publicVariants as unknown as PublicVariants }));
}

export function serializeListingPublic(l: ListingWith, cancellationPolicy: { key: string; name: string; description: string | null; rules: unknown } | null) {
  const photos = publicPhotos(l.photos);
  return {
    id: l.id,
    title: l.title,
    description: l.description,
    propertyType: l.property?.propertyType ?? null,
    publicAreaLabel: l.publicAreaLabel,
    city: l.property?.city ?? null,
    state: l.property?.state ?? null,
    approxLatitude: l.approxLatitude,
    approxLongitude: l.approxLongitude,
    maxGuests: l.maxGuests,
    bedrooms: l.bedrooms,
    beds: l.beds,
    bathrooms: l.bathrooms,
    houseRules: houseRulesOf(l),
    checkInTime: l.checkInTime,
    checkOutTime: l.checkOutTime,
    basePricePaise: num(l.basePricePaise),
    weekendPricePaise: num(l.weekendPricePaise, true),
    cleaningFeePaise: num(l.cleaningFeePaise),
    minNights: l.minNights,
    maxNights: l.maxNights,
    advanceNoticeHours: l.advanceNoticeHours,
    maxAdvanceDays: l.maxAdvanceDays,
    bookingMode: l.bookingMode,
    cancellationPolicy,
    amenities: (l.amenities ?? []).map((a) => ({ slug: a.amenity.slug, name: a.amenity.name, group: a.amenity.group, iconKey: a.amenity.iconKey })),
    photos,
    coverPhoto: photos[0] ?? null,
    ratingAvg: l.ratingAvg,
    ratingCount: l.ratingCount,
    publishedAt: iso(l.publishedAt),
  };
}

export function serializeListingOwner(
  l: ListingWith,
  extra: { photoPreviews: Record<string, string>; completeness: Array<{ item: string; ok: boolean }> },
) {
  return {
    id: l.id,
    reference: l.reference,
    propertyId: l.propertyId,
    status: l.status,
    title: l.title,
    description: l.description,
    propertyType: l.property?.propertyType ?? null,
    maxGuests: l.maxGuests,
    bedrooms: l.bedrooms,
    beds: l.beds,
    bathrooms: l.bathrooms,
    houseRules: houseRulesOf(l),
    checkInTime: l.checkInTime,
    checkOutTime: l.checkOutTime,
    basePricePaise: num(l.basePricePaise),
    weekendPricePaise: num(l.weekendPricePaise, true),
    cleaningFeePaise: num(l.cleaningFeePaise),
    minNights: l.minNights,
    maxNights: l.maxNights,
    advanceNoticeHours: l.advanceNoticeHours,
    maxAdvanceDays: l.maxAdvanceDays,
    bookingMode: l.bookingMode,
    cancellationPolicyKey: l.cancellationPolicyKey,
    turnoverCleaningEnabled: l.turnoverCleaningEnabled,
    publicAreaLabel: l.publicAreaLabel,
    approxLatitude: l.approxLatitude,
    approxLongitude: l.approxLongitude,
    checkinInstructions: l.checkinInstructions,
    amenityIds: (l.amenities ?? []).map((a) => a.amenity.id),
    photos: [...(l.photos ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((p) => ({
        id: p.id,
        attachmentId: p.attachmentId,
        position: p.position,
        caption: p.caption,
        isCover: p.isCover,
        previewUrl: extra.photoPreviews[p.id] ?? null,
        isPublic: !!p.publicVariants,
      })),
    ratingAvg: l.ratingAvg,
    ratingCount: l.ratingCount,
    pausedBy: l.pausedBy,
    editedSinceReview: l.editedSinceReview,
    publishedAt: iso(l.publishedAt),
    submittedAt: iso(l.submittedAt),
    reviewedAt: iso(l.reviewedAt),
    completeness: extra.completeness,
    updatedAt: iso(l.updatedAt),
  };
}
