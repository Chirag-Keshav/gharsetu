
/** Server-side fetch for public, cache-friendly pages. Never forwards cookies (SPEC §12.9). */
const origin = process.env.API_INTERNAL_URL ?? 'http://localhost:4000';

export async function publicApi<T>(path: string, revalidate = 30): Promise<T | null> {
  try {
    const res = await fetch(`${origin}/api/v1${path}`, { next: { revalidate } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export interface PublicVariant {
  url: string;
  width: number;
  height: number;
}

export interface ListingCardData {
  id: string;
  title: string;
  publicAreaLabel: string;
  city: string;
  state: string;
  propertyType: string;
  maxGuests: number;
  bedrooms: number;
  beds: number;
  bathrooms: number;
  priceFromPaise: number;
  stayTotalPaise: number | null;
  ratingAvg: number | null;
  ratingCount: number;
  bookingMode: string;
  coverPhoto: { sm: PublicVariant; lg: PublicVariant } | null;
}
