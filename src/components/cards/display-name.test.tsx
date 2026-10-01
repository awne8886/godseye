// @vitest-environment jsdom
/**
 * Round 5 visual-qa m4: card subtitles were raw internal keys — fire "M-202609301826--4.26633--5…",
 * malware "at:20.1825,80.0024", outage "ioda-CD-1790822400-bgp", camera "caltrans-d1-168". The frame
 * now shows the record's display name (or its own coordinates) and keeps the key on the SOURCES tab.
 * Records come from the real parsers over recorded upstream fixtures (2026-09-30).
 */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { fixtureText } from '@/features/hazards/server/__fixtures__';
import { parseFirmsCsv } from '@/features/hazards/server/firms-parse';
import { mapIoda } from '@/features/network/server/outages';
import * as cams from '@/features/surveillance/server/adapters';
import { fixture, FX as THREAT_FX } from '@/features/threats/server/__fixtures__';
import type { Selection } from '@/lib/layer-host';
import { entityDisplayName } from './display-name';
import EntityCardFrame from './EntityCardFrame';

afterEach(cleanup);

const record = <T extends object>(t: T) => t as unknown as Record<string, unknown>;

const firePixel = parseFirmsCsv(fixtureText('J1_VIIRS_C2_Global_24h.2026-09-30.csv'), 'NOAA20').top[0]!;
const fire: Selection = { kind: 'fire', id: firePixel.id, layer: 'fires', source: 'firms_viirs_noaa20', observedAt: new Date(firePixel.seenAt * 1000).toISOString(), data: record(firePixel), lngLat: [firePixel.lng, firePixel.lat] };

const ioda = JSON.parse(fixture(THREAT_FX.ioda).toString('utf8')) as { data: Parameters<typeof mapIoda>[0]; requestParameters: { until: string } };
const outageRec = mapIoda(ioda.data, Number(ioda.requestParameters.until)).find((o) => o.countryCode === 'BM')!;
const outage: Selection = { kind: 'outage', id: outageRec.id, layer: 'cf_outages', source: outageRec.source, observedAt: outageRec.startedAt, data: record(outageRec), lngLat: [outageRec.lng, outageRec.lat] };

// The surveillance fixture helper resolves via import.meta.url, which jsdom rewrites; read by path.
const caltrans = JSON.parse(readFileSync(join(process.cwd(), 'src/features/surveillance/server/__fixtures__/caltrans-d7.2026-09-30.json'), 'utf8')) as Parameters<typeof cams.parseCaltrans>[0];
const camRec = cams.parseCaltrans(caltrans, 7)[0]!;
const camera: Selection = { kind: 'camera', id: camRec.id, layer: 'cctv', source: camRec.source, observedAt: camRec.observedAt, data: record(camRec), lngLat: [camRec.lng, camRec.lat] };

/** A co-located URLhaus group as NetworkLayer builds it (`at:<lat>,<lng>`, `colocated` members). */
const malwareGroup: Selection = {
  kind: 'malware_host',
  id: 'at:20.1825,80.0024',
  layer: 'malware',
  source: 'urlhaus',
  observedAt: '2026-09-30T19:54:23.000Z',
  data: { id: '1.2.3.4', ip: '1.2.3.4', port: 80, lat: 20.1825, lng: 80.0024, colocated: 18 },
  lngLat: [80.0024, 20.1825],
};

describe('entity card subtitles are display names, never internal keys (round 5 visual-qa m4)', () => {
  it('names each reviewed record by what it is', () => {
    expect(fire.id).toMatch(/^[A-Z0-9-]+-/);
    expect(entityDisplayName(fire)).toMatch(/^\d+\.\d{3}°[NS] \d+\.\d{3}°[EW]$/);
    expect(outage.id).toMatch(/^ioda-BM-/);
    expect(entityDisplayName(outage)).toMatch(/^Bermuda/);
    expect(camera.id).toMatch(/^caltrans-d7-/);
    expect(entityDisplayName(camera)).toBe(camRec.name);
    expect(entityDisplayName(malwareGroup)).toBe('18 hosts · 20.183°N 80.002°E');
    for (const s of [fire, outage, camera, malwareGroup]) expect(entityDisplayName(s)).not.toBe(s.id);
  });

  it('uses each kind’s own name fields and invents nothing', () => {
    const base = { layer: null, source: 'x', observedAt: null, lngLat: null } as const;
    expect(entityDisplayName({ ...base, kind: 'aircraft', id: '4ca2b3', data: { callsign: 'RYR12AB', registration: 'EI-DCL' } })).toBe('RYR12AB · EI-DCL');
    expect(entityDisplayName({ ...base, kind: 'aircraft', id: '4ca2b3', data: { callsign: null, registration: null } })).toBe('HEX 4CA2B3');
    expect(entityDisplayName({ ...base, kind: 'satellite', id: '25544', data: { name: 'ISS (ZARYA)', noradId: 25544 } })).toBe('ISS (ZARYA)');
    expect(entityDisplayName({ ...base, kind: 'earthquake', id: 'us7000abcd', data: { place: '12 km SW of Ridgecrest, CA' } })).toBe('12 km SW of Ridgecrest, CA');
    expect(entityDisplayName({ ...base, kind: 'vessel', id: '244123456', data: { name: null, callsign: null, mmsi: '244123456' } })).toBe('MMSI 244123456');
    expect(entityDisplayName({ ...base, kind: 'conflict_zone', id: 'UKRAINE WAR', data: { label: 'UKRAINE WAR' } })).toBe('UKRAINE WAR');
    // A port keeps the line its module chose (curated name or upstream index).
    expect(entityDisplayName({ ...base, kind: 'port', id: 'wpi-12345', data: { name: 'ROTTERDAM' } })).toBe('wpi-12345');
    // Nothing to name it by and no position: no line at all, never the key.
    expect(entityDisplayName({ ...base, kind: 'frontline', id: 'feature-77', data: { name: null } })).toBeNull();
  });

  it('the frame prints the display name under the kind and the key only on the SOURCES tab', () => {
    render(
      <EntityCardFrame selection={outage} feed={undefined} onClose={() => {}}>
        <p>body</p>
      </EntityCardFrame>,
    );
    const subtitle = document.querySelector('header h2 + p')!;
    expect(subtitle.textContent).toMatch(/^Bermuda/);
    expect(subtitle.className).toContain('line-clamp-2');
    expect(subtitle.className).not.toContain('truncate');
    expect(screen.queryByText(outage.id)).toBeNull();
    fireEvent.click(screen.getByRole('tab', { name: 'sources' }));
    expect(screen.getByTestId('card-id').textContent).toBe(outage.id);
  });

  it('omits the line when there is nothing honest to show', () => {
    render(
      <EntityCardFrame selection={{ kind: 'frontline', id: 'feature-77', layer: 'frontlines', source: 'deepstate', observedAt: null, data: { name: null }, lngLat: null }} feed={undefined} onClose={() => {}}>
        <p>body</p>
      </EntityCardFrame>,
    );
    expect(document.querySelector('header h2 + p')).toBeNull();
    expect(screen.queryByText('feature-77')).toBeNull();
  });

  it('gives the close button and the tabs 44 px targets in the phone layout', () => {
    render(
      <EntityCardFrame selection={camera} feed={undefined} onClose={() => {}}>
        <p>body</p>
      </EntityCardFrame>,
    );
    expect(screen.getByRole('button', { name: 'Close card' }).className).toContain('phone:h-11');
    for (const tab of screen.getAllByRole('tab')) expect(tab.className).toContain('phone:min-h-[44px]');
  });
});
