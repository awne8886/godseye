import { describe, expect, it } from 'vitest';
import { LAYERS, LAYER_GROUPS } from '@/lib/layer-registry';
import { REGION_PRESETS } from '@/lib/presets';
import { TOOLS } from '@/lib/tool-registry';
import { ICONS } from './icons';

describe('icon map', () => {
  it('covers every icon referenced by the registries', () => {
    const names = [...LAYERS.map((l) => l.icon), ...LAYER_GROUPS.map((g) => g.icon), ...TOOLS.map((t) => t.icon), ...REGION_PRESETS.map((p) => p.icon)];
    for (const n of names) expect(ICONS, n).toHaveProperty(n);
  });
});
