import { afterEach, describe, expect, it, vi } from 'vitest';
import type * as Http from '@/lib/http';
import { FX, json } from './__fixtures__/index';

const calls = vi.hoisted(() => [] as { url: string; headers: Record<string, string> }[]);

vi.mock('@/lib/http', async (orig) => {
  const real = await orig<typeof Http>();
  return {
    ...real,
    httpJson: vi.fn(async (url: string, o: { headers?: Record<string, string> } = {}) => {
      calls.push({ url, headers: o.headers ?? {} });
      return { status: 200, headers: {}, data: json(FX.tfl) };
    }),
  };
});

const { LOADERS, TFL_JAMCAM_URL, tflKeyHeaders } = await import('./loaders');
const { HttpError } = await import('@/lib/http');

afterEach(() => {
  calls.length = 0;
  vi.unstubAllEnvs();
});

describe('SEC-m4: the TfL app_key never travels in a URL', () => {
  it('sends the key as the app_key header (TfL honours it: probe 2026-09-30) and keeps the URL key-free', async () => {
    vi.stubEnv('TFL_APP_KEY', 'abc123secret');
    const rows = await LOADERS.tfl!(new AbortController().signal);
    expect(rows.length).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(TFL_JAMCAM_URL);
    expect(calls[0]!.url).not.toContain('abc123secret');
    expect(calls[0]!.url).not.toMatch(/app_key/i);
    expect(calls[0]!.headers.app_key).toBe('abc123secret');
  });

  it('strips anything but key characters and sends no header without a key', () => {
    expect(tflKeyHeaders({ TFL_APP_KEY: ' ab\r\nX-Evil: 1 ' })).toEqual({ app_key: 'abX-Evil1' });
    expect(tflKeyHeaders({})).toEqual({});
  });

  it('an HttpError carrying a keyed URL is redacted (defence in depth, src/lib/http.ts)', () => {
    const e = new HttpError('HTTP 429', 'http', 'https://api.tfl.gov.uk/Place/Type/JamCam?app_key=abc123secret', 429);
    expect(e.url).not.toContain('abc123secret');
    expect(e.url).toContain('app_key=REDACTED');
  });
});
