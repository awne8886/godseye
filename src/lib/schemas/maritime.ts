/**
 * Maritime contracts. Owner: layers-threats-network.
 * Ports and chokepoints are REFERENCE data (curated/bundled); vessels are LIVE (AISStream relay,
 * keyed). Congestion is a labelled heuristic computed from live vessel counts, never invented.
 */
import { z } from 'zod';
import { EntityBase, Envelope } from './common';

export const PortType = z.enum(['container', 'energy', 'naval', 'general']);

export const Port = EntityBase.extend({
  name: z.string(),
  country: z.string().nullable(),
  type: PortType,
  /** Where this record comes from: NGA World Port Index, Natural Earth, or the curated OSIRIS list. */
  dataset: z.enum(['wpi', 'natural-earth', 'curated']),
  harborSize: z.string().nullable(),
  rank: z.number().int().positive().nullable(),
  /** Curated throughput/fleet notes (reference text, e.g. "37.2M TEU"). */
  volume: z.string().nullable(),
  fleet: z.string().nullable(),
  /** Only set when vessels are live: ships within 50 km and how many are waiting (<0.5 kn). */
  live: z
    .object({
      shipsNearby: z.number().int().nonnegative(),
      waiting: z.number().int().nonnegative(),
      congestion: z.enum(['NORMAL', 'CONGESTED', 'SEVERE']),
      method: z.literal('heuristic: waiting ratio and count within 50 km'),
    })
    .nullable(),
});

export const RiskLevel = z.enum(['LOW', 'MODERATE', 'ELEVATED', 'HIGH', 'CRITICAL']);

export const Chokepoint = EntityBase.extend({
  name: z.string(),
  baseRisk: RiskLevel,
  /** baseRisk adjusted by live traffic when vessels are live; equals baseRisk otherwise. */
  risk: RiskLevel,
  traffic: z.string().nullable(),
  shipsNearby: z.number().int().nonnegative().nullable(),
});

export const VesselType = z.enum(['cargo', 'tanker', 'military', 'passenger', 'fishing', 'other']);

export const Vessel = EntityBase.extend({
  mmsi: z.string().regex(/^\d{9}$/),
  name: z.string().nullable(),
  callsign: z.string().nullable(),
  imo: z.string().nullable(),
  type: VesselType,
  /** AIS ship-type code (0–99). */
  aisType: z.number().int().min(0).max(99).nullable(),
  sogKt: z.number().nonnegative().nullable(),
  cogDeg: z.number().min(0).lt(360).nullable(),
  headingDeg: z.number().min(0).lt(360).nullable(),
  destination: z.string().nullable(),
  flag: z.string().nullable(),
  /** Recent positions `[lng, lat, epochSeconds]` for speed-coloured tracks. */
  track: z.array(z.tuple([z.number(), z.number(), z.number()])),
});

/** GET /api/maritime */
export const MaritimeResponse = Envelope.extend({
  ports: z.array(Port),
  chokepoints: z.array(Chokepoint),
  /** Bounded: the route filters by bbox/zoom so a keyed global AIS feed stays < 4 MB. */
  vessels: z.array(Vessel).max(10_000),
  aisConfigured: z.boolean(),
});
