/**
 * POST /api/sdk/ingest — third-party SDK entity batch (SdkIngestResponse). Fail-closed: 503 without
 * SDK_INGEST_KEY, 401 on a wrong/missing Bearer (constant-time compare), 413 past the body cap,
 * 400 on malformed JSON; entities are validated one by one and labelled THIRD-PARTY.
 * Owner: layers-threats-network.
 */
import { authorized, ingest, MAX_BODY_BYTES, readCapped } from '@/features/network/server/sdk';
import { hasCapability } from '@/lib/capabilities';
import { apiError, json, withRoute } from '@/lib/respond';

export const dynamic = 'force-dynamic';

export const POST = withRoute('/api/sdk/ingest', async (req) => {
  if (!hasCapability('sdk')) return apiError(503, 'sdk_disabled', 'SDK ingest is disabled: SDK_INGEST_KEY is not set on this server.');
  if (!authorized(req.headers.get('authorization'))) return apiError(401, 'unauthorized', 'Send Authorization: Bearer <SDK_INGEST_KEY>.', { headers: { 'WWW-Authenticate': 'Bearer' } });
  const text = await readCapped(req);
  if (text === null) return apiError(413, 'payload_too_large', `Body exceeds ${MAX_BODY_BYTES} bytes.`);
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return apiError(400, 'invalid_json', 'Body must be JSON.');
  }
  const result = ingest(body);
  if (result.accepted === 0 && result.rejected === 0) return apiError(400, 'invalid_request', result.errors[0]);
  return json(result, { status: result.accepted ? 202 : 422, ttl: 0 });
});
