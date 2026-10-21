import type { MetadataRoute } from 'next';
import { brand } from '@/lib/brand';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: brand.productName,
    short_name: brand.productName,
    description: 'Property care and short stays',
    start_url: '/',
    display: 'standalone',
    background_color: '#f7f7f4',
    theme_color: '#0f6b5c',
    icons: [{ src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' }],
  };
}
