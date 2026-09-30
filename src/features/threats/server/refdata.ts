/**
 * Bundled reference data under public/data (prepared at build time from the sources named in each
 * file's `_meta`, see docs/data-sources/layers-threats-network.md). Read once per process from disk
 * (the same files the Docker image copies with `public/`). Owner: layers-threats-network. Server-only.
 */
import 'server-only';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cache = new Map<string, unknown>();

export type RefFile = 'zones.json' | 'zones-countries.json' | 'cables.json' | 'ports.json' | 'chokepoints.json' | 'nuclear-curated.json';

export function readRef<T>(name: RefFile): T {
  let v = cache.get(name);
  if (v === undefined) {
    v = JSON.parse(readFileSync(join(process.cwd(), 'public', 'data', name), 'utf8')) as unknown;
    cache.set(name, v);
  }
  return v as T;
}
