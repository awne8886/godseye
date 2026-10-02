/**
 * GET /api/sdk/stream — SSE of third-party SDK entities: `snapshot` {entities, at} on connect,
 * `update` {entities, at} per accepted batch, `heartbeat` every 15 s. Every entity carries
 * `thirdParty: true` and the THIRD-PARTY (SDK) label. Needs the `sdk` capability.
 * Owner: layers-threats-network.
 */
import { capabilityGate } from '@/features/network/server/gate';
import { sdkHub } from '@/features/network/server/sdk';
import { withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const GET = withRoute('/api/sdk/stream', async (req) => capabilityGate('sdk', 'sdk') ?? sdkHub().subscribe(req));
