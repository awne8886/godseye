// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { THEME_BOOT_SCRIPT, THEME_STORAGE_KEY } from './theme-boot';

const run = (search: string) => {
  window.history.replaceState(null, '', `/${search}`);
  new Function(THEME_BOOT_SCRIPT)();
  return document.documentElement.getAttribute('data-theme');
};

describe('pre-paint theme script', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    localStorage.clear();
  });
  it('prefers ?theme= over the saved preset and upper-cases it', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'EMBER');
    expect(run('?theme=phantom')).toBe('PHANTOM');
  });
  it('falls back to the saved preset, ignores HORUS and junk', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'TERMINAL');
    expect(run('')).toBe('TERMINAL');
    document.documentElement.removeAttribute('data-theme');
    expect(run('?theme=HORUS')).toBeNull();
    localStorage.setItem(THEME_STORAGE_KEY, '"><img src=x>');
    expect(run('')).toBeNull();
  });
});
