/**
 * Fixture-backed provider loaders (recorded 2026-09-30). Imports only adapters + fixtures so a
 * vi.mock factory for ../loaders can use it without a circular import. Tests only.
 */
import type { Camera } from '@/lib/types';
import * as A from '../adapters';
import { FX, json, text } from './index';

/** Loaders answering from the recorded fixtures (one district each where the real one fans out). */
export function fixtureLoaders(): Record<string, (s: AbortSignal) => Promise<Camera[]>> {
  return {
    caltrans: async () => A.parseCaltrans(json(FX.caltrans), 7),
    wsdot: async () => A.parseWsdotKml(text(FX.wsdot)),
    odot: async () => A.parseOdot(json(FX.odot)),
    txdot: async () => A.parseTxdot(json(FX.txdot), 'AUS'),
    mdot: async () => A.parseMdot(json(FX.mdot)),
    ottawa: async () => A.parseOttawa(json(FX.ottawa)),
    quebec: async () => A.parseQuebec(json(FX.quebec)),
    toronto: async () => A.parseToronto(json(FX.toronto)),
    drivebc: async () => A.parseDriveBc(json(FX.drivebc)),
    tfl: async () => A.parseTfl(json(FX.tfl)),
    dgt: async () => A.parseDgt(json(FX.dgt)),
    rws: async () => A.parseRws(json(FX.rws)),
    digitraffic: async () => A.parseDigitraffic(json(FX.digitraffic)),
    vegagerdin: async () => A.parseVegagerdin(json(FX.vegagerdin)),
    hktd: async () => A.parseHongKong(text(FX.hktd)),
    lta: async () => A.parseLta(json(FX.lta)),
    thb: async () => A.parseThb(json(FX.thb)),
    nzta: async () => A.parseNzta(text(FX.nzta)),
    nsw: async () => A.parseLiveTrafficNsw(json(FX.nsw)),
    indot: async () => A.parseIndot(json(FX.indot)),
    // Recorded at 2026-10-01T02:10Z; parsed against that instant so the 6 h frame-age filter is stable.
    vialietuva: async () => A.parseViaLietuva(json(FX.vialietuvaVkr), json(FX.vialietuvaInfo), Date.parse('2026-10-01T02:10:00Z')),
  };
}

