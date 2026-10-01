import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import type { ReactNode } from 'react';
import { APP_NAME, APP_SUBTITLE, REPO_URL } from '@/lib/config';
import { THEME_BOOT_SCRIPT } from '@/lib/theme-boot';
import Providers from './providers';
import './globals.css';

// Fonts are bundled from @fontsource (OFL) so builds never depend on fonts.googleapis.com.
const mono = localFont({
  src: '../../node_modules/@fontsource-variable/jetbrains-mono/files/jetbrains-mono-latin-wght-normal.woff2',
  weight: '100 800',
  variable: '--font-jetbrains-mono',
  display: 'swap',
  fallback: ['ui-monospace', 'monospace'],
});
const inter = localFont({
  src: '../../node_modules/@fontsource-variable/inter/files/inter-latin-wght-normal.woff2',
  weight: '100 900',
  variable: '--font-inter',
  display: 'swap',
  fallback: ['system-ui', 'sans-serif'],
});
// Display face is used only for the wordmark and docs headings: don't preload it on the map route.
const grotesk = localFont({
  src: [
    { path: '../../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-500-normal.woff2', weight: '500' },
    { path: '../../node_modules/@fontsource/space-grotesk/files/space-grotesk-latin-700-normal.woff2', weight: '700' },
  ],
  variable: '--font-space-grotesk',
  display: 'swap',
  preload: false,
  fallback: ['system-ui', 'sans-serif'],
});

export const metadata: Metadata = {
  title: `${APP_NAME} — ${APP_SUBTITLE}`,
  description: 'Open-source, keyless, real-time global monitor: flights, maritime, satellites, public cameras, hazards and cyber — with honest data provenance and a flight path planner.',
  applicationName: APP_NAME,
  manifest: '/manifest.webmanifest',
  other: { 'source-code': REPO_URL },
};

export const viewport: Viewport = {
  themeColor: '#06060C',
  colorScheme: 'dark',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // data-theme is set by the pre-paint script before hydration.
    <html lang="en" className={`${mono.variable} ${inter.variable} ${grotesk.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOT_SCRIPT }} />
      </head>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
