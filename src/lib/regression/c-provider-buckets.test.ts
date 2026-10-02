// Phase 3 round 1 R3-B1: two call sites registering one upstream bucket with different rates made
// providerBucket() throw, which took /api/cyber-threats or the chain brief down for the process
// lifetime depending on which ran first. Every literal registration of a name must agree.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

function* sources(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) yield* sources(p);
    else if (/\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name)) yield p;
  }
}

const NUMERIC = /^[\d\s._/*+-]+$/;
const evalNum = (expr: string) => (NUMERIC.test(expr) ? (new Function(`return (${expr.replace(/_/g, '')})`)() as number) : NaN);

describe('provider buckets', () => {
  it('every literal providerBucket(name, rate, burst) registration of one name agrees', () => {
    const seen = new Map<string, { rate: number; burst: number; at: string }>();
    const conflicts: string[] = [];
    const root = path.join(process.cwd(), 'src');
    for (const file of sources(root)) {
      const text = readFileSync(file, 'utf8');
      for (const m of text.matchAll(/providerBucket\(\s*'([^']+)'\s*,\s*([^,)]+?)\s*(?:,\s*([^,)]+?)\s*)?\)/g)) {
        const [, name = '', rateExpr = '', burstExpr] = m;
        const rate = evalNum(rateExpr);
        const burst = burstExpr === undefined ? 1 : evalNum(burstExpr);
        if (Number.isNaN(rate) || Number.isNaN(burst)) continue; // computed arguments: checked at runtime
        const at = `${path.relative(root, file)}:${text.slice(0, m.index).split('\n').length}`;
        const prev = seen.get(name);
        if (!prev) seen.set(name, { rate, burst, at });
        else if (Math.abs(prev.rate - rate) > 1e-9 || prev.burst !== burst) conflicts.push(`${name}: ${prev.at} (${prev.rate}/s, ${prev.burst}) vs ${at} (${rate}/s, ${burst})`);
      }
    }
    expect(seen.size).toBeGreaterThan(10);
    expect(conflicts).toEqual([]);
  });

  it('NVD callers share nvdBucket()', async () => {
    const { nvdBucket } = await import('@/lib/ratelimit');
    expect(nvdBucket(false)).toBe(nvdBucket(false));
    expect(nvdBucket(true).ratePerSec).toBeCloseTo(50 / 30);
    for (const f of ['src/features/network/server/kev.ts', 'src/components/panels/intel/server/chain.ts', 'src/components/panels/recon/server/osint.ts']) {
      expect(readFileSync(f, 'utf8')).not.toMatch(/providerBucket\('nvd/);
    }
  });
});
