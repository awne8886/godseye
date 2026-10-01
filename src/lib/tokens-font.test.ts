// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { hudFontFamily } from './tokens';

describe('hudFontFamily', () => {
  it('returns the resolved --font-hud stack (the bundled font has a generated family name)', () => {
    document.documentElement.style.setProperty('--font-hud', '"mono", "mono Fallback", ui-monospace, monospace');
    expect(hudFontFamily()).toBe('"mono", "mono Fallback", ui-monospace, monospace');
  });

  it('falls back to a named stack when the variable is not set', () => {
    document.documentElement.style.removeProperty('--font-hud');
    expect(hudFontFamily()).toContain('monospace');
  });
});
