// @vitest-environment jsdom
// visual-qa M7: every DRAW tool button keeps its lucide icon (the 4-up grid squeezed POLYGON's icon to
// nothing and CIRCLE's to a dot). jsdom has no layout, so this pins the structure that prevents it:
// a two-column grid and non-shrinking icons.
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import DrawPanel from './DrawPanel';
import { useOverlayStore } from '../recon/overlay-store';

afterEach(() => {
  cleanup();
  useOverlayStore.getState().setDrawMode(null);
});

describe('DrawPanel tool buttons', () => {
  it('renders an icon that cannot shrink in every tool button, two per row', () => {
    render(<DrawPanel {...({} as Parameters<typeof DrawPanel>[0])} />);
    const group = screen.getByRole('group', { name: 'Drawing tools' });
    expect(group.className).toContain('grid-cols-2');
    const buttons = Array.from(group.querySelectorAll('button'));
    expect(buttons.map((b) => b.textContent?.trim())).toEqual(['Point', 'Line', 'Polygon', 'Circle']);
    for (const b of buttons) {
      const svg = b.querySelector('svg');
      expect(svg, b.textContent ?? '').not.toBeNull();
      expect(svg!.getAttribute('class')).toContain('shrink-0');
      expect(svg!.getAttribute('width')).toBe('14');
      expect(svg!.getAttribute('aria-hidden')).toBe('true');
      expect(b.className).toContain('[&>svg]:shrink-0');
    }
  });

  it('toggles the tool with aria-pressed', () => {
    render(<DrawPanel {...({} as Parameters<typeof DrawPanel>[0])} />);
    const polygon = screen.getByRole('button', { name: 'Polygon' });
    expect(polygon.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(polygon);
    expect(polygon.getAttribute('aria-pressed')).toBe('true');
    expect(useOverlayStore.getState().drawMode).toBe('polygon');
  });
});
