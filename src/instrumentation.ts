/**
 * Boot hook: registers every feed and starts the eager ones (the single upstream poller, §4).
 * Owner: lead.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== 'nodejs') return;
  if (process.env.GODSEYE_DISABLE_POLLER === 'true') return;
  await import('./server/feeds');
  const { startEagerFeeds } = await import('./lib/feeds');
  startEagerFeeds();
}
