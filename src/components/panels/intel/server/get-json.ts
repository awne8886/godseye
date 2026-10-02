/**
 * httpJson() without conditional-GET semantics: these lookups never send validators, so a body is
 * always expected. Owner: panels-alerts-markets-dossier-graph. Server-only.
 */
import 'server-only';
import { httpJson, type HttpOptions } from '@/lib/http';

export async function getJson<T>(url: string, opts: HttpOptions = {}): Promise<{ data: T; status: number }> {
  const r = await httpJson<T>(url, opts);
  if (r.data === undefined) throw new Error('empty');
  return { data: r.data, status: r.status };
}
