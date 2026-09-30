/**
 * Boot hook: registers every feed and starts the eager ones (the single upstream poller, §4).
 * Owner: lead.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  const e = process.env;
  if (e.NODE_ENV === 'production' && !e.VERCEL && !e.TRUSTED_PLATFORM && !e.TRUST_PROXY_HEADER && !e.TRUSTED_PROXY_HOPS) {
    // Rate limits key on the X-Forwarded-For entry our proxy appends; without a proxy that
    // overwrites it, clients choose their own bucket (README "Deployment notes").
    console.warn('[godseye] No trusted proxy configured: put a reverse proxy that overwrites X-Forwarded-For in front and set TRUSTED_PROXY_HOPS (docker compose sets it), or rate limits can be evaded.');
  }
  if (process.env.GODSEYE_DISABLE_POLLER === 'true') return;
  await import('./server/feeds');
  const { startEagerFeeds } = await import('./lib/feeds');
  startEagerFeeds();
}
