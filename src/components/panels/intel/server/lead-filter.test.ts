import { describe, expect, it } from 'vitest';
describe('lead stop-list: Russian/Ukrainian hate terms (round 3)', () => {
  it('matches the added slurs but not ordinary words that share letters', async () => {
    const { hasStopTerm } = await import('./lead-filter');
    for (const t of ['москали снова', 'эти укры', 'русня бежит']) expect(hasStopTerm(t), t).toBe(true);
    for (const t of ['укрытие для гражданских', 'укроп и петрушка', 'Москва заявила']) expect(hasStopTerm(t), t).toBe(false);
  });
});
