/**
 * React side of the admission scheduler (perf B2): `useAdmission(when, id, priority)` turns true
 * once `when` has held and the scheduler gave this unit its slot; it stays true. The flip is a
 * transition (`startTransition`), so what it mounts renders in time slices instead of one long
 * task — never `flushSync`. Owner: map-engine.
 */
import { startTransition, useEffect, useRef, useState } from 'react';
import { useAdmissionStore } from './admission-scheduler';

export function useAdmission(when: boolean, id: string, priority: number): boolean {
  const scheduler = useAdmissionStore((s) => s.scheduler);
  const [done, setDone] = useState(false);
  const want = useRef(false);
  useEffect(() => {
    want.current = when && !done;
    scheduler?.kick();
  }, [when, done, scheduler]);
  useEffect(() => {
    if (!scheduler || done) return;
    return scheduler.register({
      id,
      priority,
      pending: () => (want.current ? 1 : 0),
      admitOne: () => {
        want.current = false;
        startTransition(() => setDone(true));
      },
    });
  }, [scheduler, done, id, priority]);
  return done;
}
