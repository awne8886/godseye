// @vitest-environment jsdom
import { act, cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { THEME_STORAGE_KEY } from '@/lib/theme-boot';
import { useUiStore } from '@/lib/store';
import { useStudioStore } from './hud-store';
import { STUDIO_STORAGE_KEY, STYLE_EVENT } from './style-engine';
import ThemeSync from './ThemeSync';

const root = () => document.documentElement;

beforeEach(() => {
  localStorage.clear();
  root().removeAttribute('data-theme');
  root().removeAttribute('data-ghost');
  root().removeAttribute('style');
  useUiStore.setState({ theme: 'HORUS', ghost: false, sensor: 'none' });
  useStudioStore.setState({ settings: { colours: {}, map: {}, knobs: {} }, loaded: false });
});
afterEach(cleanup);

describe('ThemeSync', () => {
  it('applies presets, persists godseye:theme and announces godseye:style', () => {
    const heard = vi.fn();
    window.addEventListener(STYLE_EVENT, heard);
    render(<ThemeSync />);
    act(() => useUiStore.getState().setTheme('NVG'));
    expect(root().getAttribute('data-theme')).toBe('NVG');
    expect(localStorage.getItem(THEME_STORAGE_KEY)).toBe('NVG');
    expect(heard).toHaveBeenCalled();
    act(() => useUiStore.getState().setTheme('HORUS'));
    expect(root().hasAttribute('data-theme')).toBe(false);
    window.removeEventListener(STYLE_EVENT, heard);
  });

  it('restores the saved preset when the URL names none', () => {
    localStorage.setItem(THEME_STORAGE_KEY, 'crimson');
    render(<ThemeSync />);
    expect(useUiStore.getState().theme).toBe('CRIMSON');
    expect(root().getAttribute('data-theme')).toBe('CRIMSON');
  });

  it('ignores hostile saved studio JSON and applies sanitised values as inline properties', () => {
    localStorage.setItem(STUDIO_STORAGE_KEY, JSON.stringify({ colours: { accent: '#ff8800', textMuted: 'red;}*{x:y' }, knobs: { blur: 500 } }));
    render(<ThemeSync />);
    expect(root().style.getPropertyValue('--gold-primary')).toBe('#ff8800');
    expect(root().style.getPropertyValue('--text-muted')).toBe('');
    expect(root().style.getPropertyValue('--blur')).toBe('64px');
    expect(root().getAttribute('data-studio')).toBe('on');
  });

  it('Ghost Protocol wins over studio colours; sensor and motion attributes follow the store', () => {
    render(<ThemeSync />);
    act(() => useStudioStore.getState().set({ colours: { accent: '#ff8800' }, map: {}, knobs: { grain: 0.1 } }));
    expect(root().style.getPropertyValue('--gold-primary')).toBe('#ff8800');
    act(() => useUiStore.getState().setGhost(true));
    expect(root().hasAttribute('data-ghost')).toBe(true);
    expect(root().style.getPropertyValue('--gold-primary')).toBe('');
    expect(root().style.getPropertyValue('--fx-grain')).toBe('0.1');
    act(() => useUiStore.getState().setSensor('flir'));
    expect(root().getAttribute('data-sensor')).toBe('flir');
    act(() => useUiStore.getState().updateSettings({ motion: 'reduced' }));
    expect(root().getAttribute('data-motion')).toBe('reduced');
  });
});
