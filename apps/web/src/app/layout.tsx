import type { Metadata, Viewport } from 'next';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { Header } from '@/components/header';
import { brand } from '@/lib/brand';
import './globals.css';

export const metadata: Metadata = {
  title: { default: `${brand.productName} — property care and short stays`, template: `%s · ${brand.productName}` },
  description: 'Remote property maintenance and short-stay bookings across India.',
  manifest: '/manifest.webmanifest',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#0f6b5c' },
    { media: '(prefers-color-scheme: dark)', color: '#0f1412' },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en-IN">
      <body className="flex min-h-dvh flex-col bg-canvas text-ink antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2">
          Skip to content
        </a>
        <Header />
        <main id="main" className="flex-1">
          {children}
        </main>
        <footer className="border-t border-line bg-surface">
          <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted">
            <p>
              © {new Date().getFullYear()} {brand.legalEntityName}. Support: {brand.supportEmail}
            </p>
            <nav aria-label="Footer" className="flex gap-4">
              <Link href="/legal/terms" className="hover:text-ink">Terms</Link>
              <Link href="/legal/privacy" className="hover:text-ink">Privacy</Link>
              <Link href="/auth?intent=owner" className="hover:text-ink">For owners</Link>
            </nav>
          </div>
        </footer>
        <script
          // App-shell-only service worker (no offline writes), SPEC §5 "PWA". Production only: dev
          // chunk names are not content-hashed, so a cache there would serve stale code.
          dangerouslySetInnerHTML={{
            __html:
              process.env.NODE_ENV === 'production'
                ? "if('serviceWorker' in navigator){addEventListener('load',()=>navigator.serviceWorker.register('/sw.js').catch(()=>{}))}"
                : "if('serviceWorker' in navigator){navigator.serviceWorker.getRegistrations().then(rs=>rs.forEach(r=>r.unregister()));caches.keys().then(ks=>ks.forEach(k=>caches.delete(k)))}",
          }}
        />
      </body>
    </html>
  );
}
