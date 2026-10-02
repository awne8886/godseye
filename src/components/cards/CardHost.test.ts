import { describe, expect, it } from 'vitest';
import { panToClearSheet } from './CardHost';

describe('panToClearSheet (phone entity card)', () => {
  it('leaves the map alone when the entity is already above the sheet', () => {
    expect(panToClearSheet(200, 363)).toBe(0);
  });
  it('pans an entity under the sheet into the middle of the free space', () => {
    // 390×844 phone: quake at y 422, sheet top at 363 (visual-qa m8).
    const dy = panToClearSheet(422, 363);
    expect(422 - dy).toBeGreaterThan(56);
    expect(422 - dy).toBeLessThan(363 - 24);
    expect(dy).toBe(Math.round(422 - (56 + (363 - 56) / 2)));
  });
});
