/**
 * GET /api/radar — OSIRIS-compatible alias of /api/outages (same handler, same response).
 * Owner: layers-threats-network.
 */
export const dynamic = 'force-dynamic';

export { GET } from '../outages/route';
