/**
 * Route boilerplate for /api/osint/*: catalogue rate limit (withRoute), zod query validation,
 * people-search refusal, SSRF refusals as 400, and the OsintResponse envelope (503 with provider
 * status when no provider answered). Owner: panels-recon. Server-only.
 */
import 'server-only';
import net from 'node:net';
import { z } from 'zod';
import { HttpError } from '@/lib/http';
import { apiError, parseQuery, withRoute } from '@/lib/respond';
import { isReservedIp } from '@/lib/ssrf';
import { osintBody, osintJson, type OsintTool } from './lookup';
import type { ToolResult } from './osint';
import { PERSONAL_REFUSAL, looksPersonal } from './targets';

/** A public IPv4/IPv6 literal (private, loopback, link-local, CGNAT, documentation… refused). */
export const PublicIpParam = z
  .string()
  .trim()
  .transform((v, ctx) => {
    if (looksPersonal(v)) {
      ctx.addIssue({ code: 'custom', message: PERSONAL_REFUSAL });
      return z.NEVER;
    }
    const ip = v.replace(/^\[|\]$/g, '');
    if (!net.isIP(ip)) {
      ctx.addIssue({ code: 'custom', message: 'Enter a public IPv4 or IPv6 address' });
      return z.NEVER;
    }
    if (isReservedIp(ip)) {
      ctx.addIssue({ code: 'custom', message: 'Private, loopback or reserved addresses are not looked up' });
      return z.NEVER;
    }
    return ip;
  });

export function osintRoute<S extends z.ZodType>(
  tool: OsintTool,
  path: string,
  schema: S,
  ttl: number,
  run: (q: z.infer<S>) => Promise<(ToolResult & { query: string }) | Response>,
) {
  return withRoute(path, async (req: Request) => {
    const raw = Object.values(Object.fromEntries(new URL(req.url).searchParams));
    if (raw.some((v) => looksPersonal(v))) return apiError(400, 'invalid_request', PERSONAL_REFUSAL, { code: 'personal_identifier' });
    const q = parseQuery(req, schema);
    if (!q.ok) return q.response;
    let r: (ToolResult & { query: string }) | Response;
    try {
      r = await run(q.data);
    } catch (e) {
      if (e instanceof HttpError && e.code === 'blocked') return apiError(400, 'blocked_target', e.message);
      throw e;
    }
    if (r instanceof Response) return r;
    return osintJson(osintBody(tool, r.query, r.data, r.findings, r.providers), ttl);
  });
}
