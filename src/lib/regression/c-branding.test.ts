// Phase 3 round 3: user-facing data (camera registry rows shown on /cameras-notice and
// /api/cctv/providers, the endpoint catalogue rendered on /docs and /privacy, the sources
// register) never carries the OSIRIS name; the MIT credit lives in LICENSE/README only.
import { describe, expect, it } from 'vitest';
import { EXCLUDED_SOURCES, NOT_WIRED_SOURCES, PROVIDERS } from '@/features/surveillance/server/registry';
import { API_CATALOG } from '@/lib/api-catalog';
import { SOURCES } from '@/lib/sources';

const hits = (rows: readonly unknown[]) => rows.filter((r) => /osiris/i.test(JSON.stringify(r)));

describe('no OSIRIS branding in user-facing data', () => {
  it('camera registry, catalogue text and sources register', () => {
    expect(hits([...PROVIDERS, ...EXCLUDED_SOURCES, ...NOT_WIRED_SOURCES])).toEqual([]);
    // `osiris: boolean` is an internal parity flag, never rendered; check the rendered strings only.
    expect(hits(API_CATALOG.map(({ summary, params }) => ({ summary, params })))).toEqual([]);
    // The one allowed mention: the MIT credit row for the reused data tables.
    expect(hits(SOURCES.filter((s) => s.id !== 'osiris-curated'))).toEqual([]);
  });
});
