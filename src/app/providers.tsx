'use client';
/** Client providers: react-query, motion (honours reduced motion), nuqs URL state. Owner: lead. */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MotionConfig } from 'motion/react';
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
      <QueryClientProvider client={client}>
        <MotionConfig reducedMotion="user">{children}</MotionConfig>
      </QueryClientProvider>
    </NuqsAdapter>
  );
}
