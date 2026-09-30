import { describe, expect, it } from 'vitest';
import { KEY_BINDINGS, matchBinding } from './keyboard';

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; altKey: boolean }> = {}) => ({
  key, ctrlKey: false, metaKey: false, altKey: false, ...mods,
});

describe('keyboard map', () => {
  it('has no conflicting bindings', () => {
    const seen = new Map<string, string>();
    for (const b of KEY_BINDINGS) {
      for (const k of b.keys) {
        const sig = `${'mod' in b && b.mod ? 'mod+' : ''}${k.toLowerCase()}`;
        const prev = seen.get(sig);
        expect(prev === undefined || prev === b.action, `${sig} bound to ${prev} and ${b.action}`).toBe(true);
        seen.set(sig, b.action);
      }
    }
  });

  it('matches the §1 keyboard contract', () => {
    expect(matchBinding(ev('f'), false)).toBe('toggle-fullscreen');
    expect(matchBinding(ev('S'), false)).toBe('open-share');
    expect(matchBinding(ev('p'), false)).toBe('toggle-paths');
    expect(matchBinding(ev('g'), false)).toBe('toggle-projection');
    expect(matchBinding(ev('?'), false)).toBe('open-help');
    expect(matchBinding(ev('/'), false)).toBe('open-palette');
    expect(matchBinding(ev('k', { metaKey: true }), false)).toBe('open-palette');
    expect(matchBinding(ev('k', { ctrlKey: true }), true)).toBe('open-palette');
    expect(matchBinding(ev('f', { ctrlKey: true }), false)).toBe('open-search');
    expect(matchBinding(ev('3'), false)).toBe('sensor-flir');
  });

  it('ignores plain keys while typing but still honours Escape', () => {
    expect(matchBinding(ev('f'), true)).toBeNull();
    expect(matchBinding(ev('Escape'), true)).toBe('close');
    expect(matchBinding(ev('f', { altKey: true }), false)).toBeNull();
  });
});
