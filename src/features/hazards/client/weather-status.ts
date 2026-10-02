'use client';
/**
 * Publishes the weather layer's `unplacedCount`: NWS alerts the feed received whose zone outlines
 * are not cached yet (the route reports them as `unplacedAlerts`). The rail shows
 * "N ALERTS AWAITING ZONE OUTLINES" so a short map is not mistaken for the whole feed. An offline or
 * not-yet-loaded feed publishes 0 (there is nothing to claim), and unmount clears it.
 * Owner: layers-hazards.
 */
import { useEffect } from 'react';
import { useLayerStatusStore } from '@/lib/layer-host';

export function unplacedCountOf(body: { unplacedAlerts?: number } | null | undefined): number {
  return body?.unplacedAlerts ?? 0;
}

export function useWeatherUnplaced(body: { unplacedAlerts?: number } | null | undefined): void {
  const update = useLayerStatusStore((s) => s.update);
  const unplacedCount = unplacedCountOf(body);
  useEffect(() => {
    update('weather', { unplacedCount });
  }, [unplacedCount, update]);
  useEffect(() => () => update('weather', { unplacedCount: 0 }), [update]);
}
