/**
 * React side of the admission scheduler (perf B2): `useAdmission(when, id, priority, maxWaitMs?, ready?)`
 * turns true once `when` has held and the scheduler gave this unit its slot; it stays true. The flip
 * is a transition (`startTransition`), so what it mounts renders in time slices instead of one long
 * task — never `flushSync`. `maxWaitMs` shortens this unit's wait for a quiet slot (focus work, see
 * `focus.ts`). `ready` (default true): while false the unit is wanted and counted as pending (the
 * header says RECEIVED + DRAWING) but not admitted — the deck device waits for the basemap's first
 * painted frame this way while the data modules already fetch (perf m-l). Owner: map-engine.
 */
import { startTransition, useEffect, useRef, useState } from 'react';
import { useAdmissionStore } from './admission-scheduler';

export function useAdmission(when: boolean, id: string, priority: number, maxWaitMs?: number, ready = true): boolean {
  const scheduler = useAdmissionStore((s) => s.scheduler);
  const [done, setDone] = useState(false);
  const want = useRef(false);
  const readyRef = useRef(ready);
  useEffect(() => {
    want.current = when && !done;
    readyRef.current = ready;
    scheduler?.kick();
  }, [when, done, ready, scheduler]);
  useEffect(() => {
    if (!scheduler || done) return;
    return scheduler.register({
      id,
      priority,
      maxWaitMs,
      pending: () => (want.current ? 1 : 0),
      ready: () => readyRef.current,
      admitOne: () => {
        want.current = false;
        startTransition(() => setDone(true));
      },
    });
  }, [scheduler, done, id, priority, maxWaitMs]);
  return done;
}
