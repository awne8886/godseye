import { describe, expect, it } from 'vitest';
import { GET as GDACS } from '../gdacs/route';
import { GET, dynamic } from './route';

describe('GET /api/gdelt (alias)', () => {
  it('re-exports the /api/gdacs handler unchanged', () => {
    expect(GET).toBe(GDACS);
    expect(dynamic).toBe('force-dynamic');
  });
});
