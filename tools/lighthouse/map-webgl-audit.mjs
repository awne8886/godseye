/**
 * Lighthouse audit `godseye-map-webgl-hardware` (owner: pages-docs-privacy-ops): passes only when
 * the globe in the scored page load was drawn by WebGL2 on a hardware GPU. lighthouserc.gpu.json
 * asserts it with `minScore: 1` and pessimistic aggregation, so one software-rendered or globe-less
 * run fails the gate. Without this, a page that fell back to "WEBGL2 REQUIRED" or "BASEMAP
 * UNAVAILABLE" (cheap, light pages) could pass every contract threshold.
 */
import { Audit } from './lighthouse-module.mjs';

/**
 * Renderer or vendor strings of software rasterisers. Must equal SOFTWARE_RENDERER in
 * tools/gpu-renderer-check.ts (tools/ops-config.test.ts compares the two).
 */
export const SOFTWARE_RENDERER = /swiftshader|subzero|0x0000c0de|llvmpipe|softpipe|lavapipe|software|osmesa|mesa offscreen|basic render driver/i;
/** Values WebGL returns for RENDERER when the unmasked strings are withheld (same as the check). */
export const MASKED = /^(webkit|webkit webgl|mozilla)$/i;

export const AUDIT_ID = 'godseye-map-webgl-hardware';

/**
 * Chromium's WebGL feature status, "enabled…" without "software" (`webgl2` up to Chromium 141, only
 * `webgl` in later builds). Same rule as featureStatusProblem in tools/gpu-renderer-check.ts.
 * @param {Record<string, string> | null | undefined} featureStatus
 * @return {string | null}
 */
export function webglFeatureProblem(featureStatus) {
  const s = featureStatus?.webgl2 ?? featureStatus?.webgl;
  if (s && /^enabled/.test(s) && !/software/i.test(s)) return null;
  return `Chromium reports WebGL as "${s ?? 'missing'}"`;
}

/**
 * @typedef {{featureStatus: Record<string, string> | null, devices: unknown[], error: string | null}} SystemGpu
 * @typedef {{canvas: boolean, context: boolean, renderer: string|null, vendor: string|null, version: string|null, hardwareContext: boolean, product?: string, gpu?: SystemGpu}} MapWebGlArtifact
 * @param {MapWebGlArtifact | null | undefined} p
 * @return {{ok: boolean, displayValue: string}}
 */
export function judgeMapWebGl(p) {
  if (!p || !p.canvas) return { ok: false, displayValue: 'no map canvas' };
  if (!p.context) return { ok: false, displayValue: 'no WebGL2 context on the map canvas' };
  const renderer = p.renderer ?? 'no renderer string';
  if ([p.renderer, p.vendor].some((s) => s && SOFTWARE_RENDERER.test(s))) return { ok: false, displayValue: `software: ${renderer}` };
  if (!p.renderer || MASKED.test(p.renderer.trim())) return { ok: false, displayValue: `unknown (masked): ${renderer}` };
  if (!p.hardwareContext) return { ok: false, displayValue: `major performance caveat: ${renderer}` };
  if (!p.gpu?.featureStatus) return { ok: false, displayValue: `no GPU report (${p.gpu?.error ?? 'missing'}): ${renderer}` };
  const status = webglFeatureProblem(p.gpu.featureStatus);
  if (status) return { ok: false, displayValue: `${status}: ${renderer}` };
  return { ok: true, displayValue: p.renderer };
}

export default class MapWebGlHardware extends Audit {
  static get meta() {
    return {
      id: AUDIT_ID,
      title: 'Globe drawn by WebGL2 on a hardware GPU in this run',
      failureTitle: 'Globe NOT drawn by WebGL2 on a hardware GPU in this run',
      description:
        "The unmasked WebGL2 renderer of the MapLibre canvas in the scored page load, and Chromium's own WebGL status in the same browser. A software rasteriser, a missing canvas (fallback page), a context with a major performance caveat or WebGL not hardware-enabled fails, because the contract thresholds for `/` are meant for a hardware GPU.",
      requiredArtifacts: ['MapWebGl'],
    };
  }

  /** @param {{MapWebGl: MapWebGlArtifact}} artifacts */
  static audit(artifacts) {
    const probe = artifacts.MapWebGl;
    const { ok, displayValue } = judgeMapWebGl(probe);
    return { score: ok ? 1 : 0, displayValue, details: { type: 'debugdata', ...probe } };
  }
}
