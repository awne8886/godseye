// @vitest-environment jsdom
import { cleanup, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { KEY_BINDINGS, type KeyAction } from '@/lib/keyboard';
import { useSelectionStore } from '@/lib/layer-host';
import { DEFAULT_SETTINGS, useUiStore } from '@/lib/store';
import { useHudStore } from './hud-store';
import KeyHandler from './KeyHandler';
import { ShortcutTable } from './panels/HelpPanel';

function reset() {
  useUiStore.setState({ openPanel: null, pinnedPanels: [], projection: 'globe', sensor: 'none', flyTo: null, dossierTarget: null, settings: DEFAULT_SETTINGS });
  useUiStore.getState().setLayer('terrain_elevation', true);
  useSelectionStore.setState({ selection: null });
  useHudStore.setState({ pinnedFlyout: null });
}

function press(key: string, init: KeyboardEventInit = {}, target: EventTarget = document.body) {
  const e = new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(e);
  return e;
}

/** What each action must change in the store (every KEY_BINDINGS action is covered). */
const EXPECT: Record<KeyAction, () => void> = {
  'toggle-fullscreen': () => expect(document.documentElement.requestFullscreen).toHaveBeenCalled(),
  'open-share': () => expect(useUiStore.getState().openPanel).toBe('share'),
  'toggle-layers': () => expect(useUiStore.getState().openPanel).toBe('layers'),
  'toggle-markets': () => expect(useUiStore.getState().openPanel).toBe('markets'),
  'toggle-intel': () => expect(useUiStore.getState().openPanel).toBe('intel'),
  'reset-view': () => expect(useUiStore.getState().flyTo).toMatchObject({ lat: 20, lng: 0, zoom: 2.5 }),
  'toggle-projection': () => {
    expect(useUiStore.getState().projection).toBe('mercator');
    expect(useUiStore.getState().activeLayers.has('terrain_elevation')).toBe(false);
  },
  'toggle-paths': () => expect(useUiStore.getState().openPanel).toBe('paths'),
  'open-help': () => expect(useUiStore.getState().openPanel).toBe('help'),
  close: () => expect(useUiStore.getState().openPanel).toBeNull(),
  'open-palette': () => expect(useUiStore.getState().openPanel).toBe('palette'),
  'open-search': () => expect(useUiStore.getState().openPanel).toBe('search'),
  'sensor-crt': () => expect(useUiStore.getState().sensor).toBe('crt'),
  'sensor-nvg': () => expect(useUiStore.getState().sensor).toBe('nvg'),
  'sensor-flir': () => expect(useUiStore.getState().sensor).toBe('flir'),
  'sensor-noir': () => expect(useUiStore.getState().sensor).toBe('noir'),
  'sensor-none': () => expect(useUiStore.getState().sensor).toBe('none'),
};

describe('global key handler', () => {
  beforeEach(() => {
    reset();
    document.documentElement.requestFullscreen = vi.fn(() => Promise.resolve());
    render(<KeyHandler />);
  });
  afterEach(cleanup);

  for (const b of KEY_BINDINGS) {
    it(`${b.display} → ${b.action}`, () => {
      if (b.action === 'close') useUiStore.getState().setOpenPanel('share');
      if (b.action === 'sensor-none') useUiStore.getState().setSensor('nvg');
      const key = b.keys[0]!;
      const e = press(key, { ctrlKey: 'mod' in b && b.mod === true });
      expect(e.defaultPrevented).toBe(true);
      EXPECT[b.action]();
    });
  }

  it('ignores plain keys in text fields but still honours ESC and ⌘K there', () => {
    const input = document.createElement('input');
    document.body.appendChild(input);
    press('l', {}, input);
    expect(useUiStore.getState().openPanel).toBeNull();
    press('k', { metaKey: true }, input);
    expect(useUiStore.getState().openPanel).toBe('palette');
    press('Escape', {}, input);
    expect(useUiStore.getState().openPanel).toBeNull();
    input.remove();
  });

  it('ignores contenteditable, textarea and select targets', () => {
    for (const tag of ['textarea', 'select']) {
      const el = document.createElement(tag);
      document.body.appendChild(el);
      press('m', {}, el);
      el.remove();
    }
    const div = document.createElement('div');
    div.setAttribute('contenteditable', 'true');
    document.body.appendChild(div);
    press('m', {}, div);
    div.remove();
    expect(useUiStore.getState().openPanel).toBeNull();
  });

  it('ignores auto-repeat, IME composition and Alt chords', () => {
    press('l', { repeat: true });
    press('l', { isComposing: true });
    press('l', { altKey: true });
    expect(useUiStore.getState().openPanel).toBeNull();
  });

  it('pauses inside a modal dialog', () => {
    const modal = document.createElement('div');
    modal.setAttribute('aria-modal', 'true');
    const btn = document.createElement('button');
    modal.appendChild(btn);
    document.body.appendChild(modal);
    press('l', {}, btn);
    expect(useUiStore.getState().openPanel).toBeNull();
    modal.remove();
  });

  it('ESC closes the innermost thing first: flyout, then panel, then card', () => {
    useHudStore.getState().setPinnedFlyout('aviation');
    useUiStore.getState().setOpenPanel('layers');
    useSelectionStore.getState().select({ kind: 'earthquake', id: 'us1', layer: 'earthquakes', source: 'usgs', observedAt: null, data: {}, lngLat: null });
    press('Escape');
    expect(useHudStore.getState().pinnedFlyout).toBeNull();
    expect(useUiStore.getState().openPanel).toBe('layers');
    press('Escape');
    expect(useUiStore.getState().openPanel).toBeNull();
    expect(useSelectionStore.getState().selection).not.toBeNull();
    press('Escape');
    expect(useSelectionStore.getState().selection).toBeNull();
  });

  it('ESC on the dossier clears its target', () => {
    useUiStore.getState().openDossier({ lat: 1, lng: 2 });
    press('Escape');
    expect(useUiStore.getState().dossierTarget).toBeNull();
    expect(useUiStore.getState().openPanel).toBeNull();
  });
});

describe('help overlay', () => {
  afterEach(cleanup);
  it('lists exactly KEY_BINDINGS, in order (the timeline slider keys are a separate table)', () => {
    const { container } = render(<ShortcutTable />);
    const rows = [...container.querySelectorAll('[data-testid="shortcut-table"] tbody tr')];
    expect(rows.map((r) => r.getAttribute('data-action'))).toEqual(KEY_BINDINGS.map((b) => b.action));
    expect(rows.map((r) => r.querySelector('kbd')?.textContent)).toEqual(KEY_BINDINGS.map((b) => b.display));
    expect(rows.map((r) => r.querySelectorAll('td')[1]?.textContent)).toEqual(KEY_BINDINGS.map((b) => b.description));
  });
});
