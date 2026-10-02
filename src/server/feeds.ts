/**
 * Registers every server feed (imported by instrumentation and /api/health). Owner: lead.
 */
import 'server-only';
import type { Feed } from '@/lib/feeds';
import { feeds as aviation } from '@/features/aviation/feeds';
import { feeds as space } from '@/features/space/feeds';
import { feeds as hazards } from '@/features/hazards/feeds';
import { feeds as surveillance } from '@/features/surveillance/feeds';
import { feeds as threats } from '@/features/threats/feeds';
import { feeds as network } from '@/features/network/feeds';
import { feeds as maritime } from '@/features/maritime/feeds';
import { feeds as flightPaths } from '@/features/flight-paths/feeds';
import { feeds as intel } from '@/components/panels/intel/feeds';

export const ALL_FEEDS: readonly Feed<unknown>[] = [...aviation, ...space, ...hazards, ...surveillance, ...threats, ...network, ...maritime, ...flightPaths, ...intel];
