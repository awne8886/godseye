import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono, Space_Grotesk } from 'next/font/google';
import type { ReactNode } from 'react';
import { APP_NAME, APP_SUBTITLE, REPO_URL } from '@/lib/config';
import { THEME_BOOT_SCRIPT } from '@/lib/theme-boot';
import Providers from './providers';
import './globals.css';

const mono = JetBrains_Mono({ subsets: ['latin'], variable: '--font-jetbrains-mono', display: 'swap' });
const inter = Inter({ subsets: ['latin'], variable: '--font-inter', display: 'swap' });
// Display face is used only for the wordmark and docs headings: don't preload it on the map route.
const grotesk = Space_Grotesk({ subsets: ['latin'], variable: '--font-space-grotesk', display: 'swap', weight: ['500', '700'], preload: false });

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
