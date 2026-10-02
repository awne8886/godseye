/**
 * IconLayer that treats the atlas alpha as a signed distance field (icons.ts): a crisp edge at
 * 0.5 at any size plus a dark outline band in the instance colour, which keeps aircraft legible
 * over the satellite basemap. Picking is untouched (the injection is skipped while picking).
 * Client-only.
 */
import { IconLayer, type IconLayerProps } from '@deck.gl/layers';

const SDF_MAIN_END = /* glsl */ `
if (!bool(picking.isActive)) {
  float d = texColor.a;
  float w = max(fwidth(d), 0.02);
  float body = smoothstep(0.5 - w, 0.5 + w, d);
  float outline = smoothstep(0.3 - w, 0.3 + w, d);
  fragColor = vec4(mix(vColor.rgb * 0.18, vColor.rgb, body), outline * layer.opacity * vColor.a);
  if (fragColor.a < 0.01) discard;
}
`;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export class SdfIconLayer<D = any> extends IconLayer<D, Record<string, unknown>> {
  static override layerName = 'SdfIconLayer';

  override getShaders() {
    const shaders = super.getShaders();
    return { ...shaders, inject: { ...(shaders.inject ?? {}), 'fs:#main-end': SDF_MAIN_END } };
  }
}

export type SdfIconLayerProps<D> = IconLayerProps<D>;
