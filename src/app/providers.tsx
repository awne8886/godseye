'use client';
/**
 * Client providers: react-query and nuqs URL state. Owner: lead. Motion is configured where it is
 * used (HudMotion's MotionScope: reducedMotion "user" + the Settings override), so the first-load
 * bundle carries no motion code.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { NuqsAdapter } from 'nuqs/adapters/next/app';
import { useState, type ReactNode } from 'react';

export default function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // Per-layer polling comes from the registry's refreshMs; background tabs pause.
            refetchIntervalInBackground: false,
            refetchOnWindowFocus: false,
            retry: 2,
            staleTime: 10_000,
          },
        },
      }),
  );
  return (
    <NuqsAdapter>
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    </NuqsAdapter>
  );
}
