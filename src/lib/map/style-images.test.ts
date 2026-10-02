import { describe, expect, it, vi } from 'vitest';
import { installMissingImageResolver, sdfDot } from './style-images';

describe('circle-11 SDF dot', () => {
  it('is a white SDF disc: opaque-ish inside, edge at 0.75, transparent in the buffer', () => {
    const img = sdfDot(22, 3);
    expect(img.width).toBe(22);
    expect(img.data).toHaveLength(22 * 22 * 4);
    const alpha = (x: number, y: number) => img.data[(y * 22 + x) * 4 + 3]!;
    expect(alpha(11, 11)).toBeGreaterThan(191); // inside > 0.75
    expect(alpha(0, 0)).toBe(0); // corner: beyond the buffer
    expect(img.data[0]).toBe(255); // colour comes from icon-color, so RGB is white
  });
});

describe('missing-image resolver', () => {
  function fakeMap() {
    const images = new Set<string>();
    let resolver: ((id: string) => void | Promise<void>) | null = null;
    return {
      images,
      resolve: (id: string) => resolver?.(id),
      hasImage: vi.fn((id: string) => images.has(id)),
      addImage: vi.fn((id: string) => void images.add(id)),
      setMissingStyleImageResolver: vi.fn((r: typeof resolver) => {
        resolver = r;
      }),
    };
  }

  it('registers a resolver that adds circle-11 once, as an SDF at pixelRatio 2', async () => {
    const map = fakeMap();
    installMissingImageResolver(map as never);
    expect(map.setMissingStyleImageResolver).toHaveBeenCalledTimes(1);
    await map.resolve('circle-11');
    expect(map.addImage).toHaveBeenCalledWith('circle-11', expect.objectContaining({ width: 22, height: 22 }), { sdf: true, pixelRatio: 2 });
    await map.resolve('circle-11');
    expect(map.addImage).toHaveBeenCalledTimes(1);
  });

  it('leaves unknown ids to the styleimagemissing event', async () => {
    const map = fakeMap();
    installMissingImageResolver(map as never);
    await map.resolve('wood-pattern');
    expect(map.addImage).not.toHaveBeenCalled();
  });
});
