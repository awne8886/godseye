import { describe, expect, it } from 'vitest';
import { foldMixedScript, hasStopTerm, leadEligible } from './lead-filter';

describe('lead stop-list: Russian/Ukrainian hate terms (round 3)', () => {
  it('matches the added slurs but not ordinary words that share letters', () => {
    for (const t of ['москали снова', 'эти укры', 'русня бежит']) expect(hasStopTerm(t), t).toBe(true);
    for (const t of ['укрытие для гражданских', 'укроп и петрушка', 'Москва заявила']) expect(hasStopTerm(t), t).toBe(false);
  });
});

// R3 round-4 MINOR-3 (ported repro stoplist-r4): the москал/русня prefix rules blocked surnames
// and place names. Every one of these must pass as an ordinary lead.
describe('lead stop-list: names and ordinary words pass (round 4)', () => {
  it.each([
    'Омбудсмен Татьяна Москалькова сообщила об обмене пленными',
    'Министр Москаленко заявил',
    'Moskalenko said',
    'Генерал Москалёв назначен',
    'Москальова',
    'Обстрел села Москалівка',
    'Русняк',
    'Иван Русняк заявил',
    'Губернатор Геннадий Москаль',
    'Москаля назначили',
    'Hennadiy Moskal said',
    'Футболист Дмитрий Хохлов',
    'Обстрел посёлка Хохол Воронежской области',
    'Khokhol, Voronezh region',
    'хохлома и гжель',
    'Khokhloma art',
    'укроп и петрушка',
    'пучок укропа',
    'укрытие для гражданских',
    'укрыть детей',
    'Укрэнерго сообщило',
    'Москва',
    'московский',
    'A chink in the armour; Pakistan; spicy',
    'Ракі і рыба',
  ])('no false positive: %s', (t) => {
    expect(hasStopTerm(t)).toBe(false);
  });

  it.each([
    'москалі атакують',
    'москали снова',
    'москалів',
    'москалям',
    'этот москаль',
    'русня наступает',
    'русню',
    'русні',
    'укропы отступили',
    'укропов',
    'укропи',
    'хохлушки',
    'хохлушка',
    'Хохлы опять',
    'хохлов',
    'эти укры',
    'Indian pаjeet', // Cyrillic а (U+0430) inside a Latin word
    'My Salute to the Indian Pajeet*',
    'xохлы', // Latin x inside a Cyrillic word
  ])('slur matched: %s', (t) => {
    expect(hasStopTerm(t)).toBe(true);
  });

  it('folds only mixed-script words (single-script words are never rewritten)', () => {
    expect(foldMixedScript('Indian pаjeet', 'latin')).toBe('Indian pajeet');
    expect(foldMixedScript('Ракі і рыба', 'latin')).toBe('Ракі і рыба');
    expect(foldMixedScript('Xохол', 'cyrillic')).toBe('Хохол');
  });

  it('checks the summary too', () => {
    expect(leadEligible({ title: 'ok', summary: 'kikes' })).toBe(false);
    expect(leadEligible({ title: 'Омбудсмен Москалькова', summary: null })).toBe(true);
  });
});
