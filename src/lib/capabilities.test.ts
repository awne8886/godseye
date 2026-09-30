import { describe, expect, it } from 'vitest';
import { evaluateCapabilities, evaluateCapability } from './capabilities';

describe('capabilities', () => {
  it('is keyless by default: keyed upgrades off, NC sources on', () => {
    const caps = evaluateCapabilities({});
    expect(caps.anthropic.enabled).toBe(false);
    expect(caps.anthropic.reason).toBe('ANTHROPIC_API_KEY not set');
    expect(caps.nc_sources.enabled).toBe(true);
    expect(caps.deepstate.enabled).toBe(false);
  });

  it('requires both the credentials and the licence flag for OpenSky', () => {
    expect(evaluateCapability('opensky', { OPENSKY_CLIENT_ID: 'a', OPENSKY_CLIENT_SECRET: 'b' }).enabled).toBe(false);
    expect(evaluateCapability('opensky', { OPENSKY_CLIENT_ID: 'a', OPENSKY_CLIENT_SECRET: 'b', OPENSKY_LICENSED: 'true' }).enabled).toBe(true);
    expect(evaluateCapability('adsbfi', { ADSBFI_PERSONAL_USE: 'yes' }).enabled).toBe(false);
  });

  it('turns off non-commercial sources on a commercial deployment', () => {
    expect(evaluateCapability('nc_sources', { COMMERCIAL_DEPLOYMENT: 'true' }).enabled).toBe(false);
    expect(evaluateCapability('deepstate', { NONCOMMERCIAL: 'true', COMMERCIAL_DEPLOYMENT: 'true' }).enabled).toBe(false);
    expect(evaluateCapability('deepstate', { NONCOMMERCIAL: 'true' }).enabled).toBe(true);
  });

  it('treats whitespace-only keys as missing', () => {
    expect(evaluateCapability('cloudflare', { CLOUDFLARE_API_TOKEN: '   ' }).enabled).toBe(false);
  });
});
