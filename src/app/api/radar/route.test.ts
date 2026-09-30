import { describe, expect, it } from 'vitest';
import { GET as OUTAGES } from '../outages/route';
import { GET, dynamic } from './route';

describe('GET /api/radar (alias)', () => {
  it('re-exports the /api/outages handler unchanged', () => {
    expect(GET).toBe(OUTAGES);
    expect(dynamic).toBe('force-dynamic');
  });
});
