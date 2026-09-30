import { describe, expect, it } from 'vitest';
import { Camera } from '@/lib/schemas/surveillance';
import * as A from './adapters';
import { FX, json, text } from './__fixtures__';

const valid = (rows: unknown[]) => rows.every((r) => Camera.safeParse(r).success);

describe('camera adapters (fixtures captured 2026-09-30)', () => {
  it('Caltrans CWWP2: in-service only, HLS where published, no inventory date as observedAt', () => {
    const rows = A.parseCaltrans(json(FX.caltrans), 7);
    expect(rows).toHaveLength(3); // index 7 is out of service
    expect(valid(rows)).toBe(true);
    expect(rows[0]).toMatchObject({ id: 'caltrans-d7-1', providerId: 'caltrans', streamType: 'hls', country: 'US', observedAt: null, headingDeg: 180 });
    expect(rows[0]!.streamUrl).toMatch(/^https:\/\/wzmedia\.dot\.ca\.gov\/D7\/.+\.m3u8$/);
    expect(rows[0]!.stillUrl).toMatch(/^https:\/\/cwwp2\.dot\.ca\.gov\/data\/d7\/cctv\/image\//);
  });

  it('WSDOT KML keeps WSDOT-hosted frames only', () => {
    const rows = A.parseWsdotKml(text(FX.wsdot));
    expect(rows).toHaveLength(3);
    expect(valid(rows)).toBe(true);
    expect(rows.every((r) => r.stillUrl!.startsWith('https://images.wsdot.wa.gov/'))).toBe(true);
    expect(rows[0]).toMatchObject({ id: 'wsdot-10147', name: 'Chewelah Municipal Airport' });
  });

  it('ODOT TripCheck Esri FeatureSet', () => {
    const rows = A.parseOdot(JSON.parse(text(FX.odot)));
    expect(rows).toHaveLength(3);
    expect(valid(rows)).toBe(true);
    expect(rows[0]!.stillUrl).toBe('https://tripcheck.com/RoadCams/cams/AstoriaUS101MeglerBrNB_pid392.jpg');
  });

  it('TxDOT new shape: roadwayCctvStatuses (+ cctvStatusRoadways[].ctts[])', () => {
    const rows = A.parseTxdot(json(FX.txdot), 'AUS');
    expect(rows.length).toBeGreaterThan(0);
    expect(valid(rows)).toBe(true);
    expect(rows[0]!.id).toBe('txdot-AUS-FM-734 @ US-290 EB');
    expect(rows[0]!.stillUrl).toBe('https://its.txdot.gov/its/DistrictIts/GetCctvSnapshotByIcdId?districtCode=AUS&icdId=FM-734%20%40%20US-290%20EB');
    expect(A.parseTxdotId(rows[0]!.id)).toEqual({ district: 'AUS', icdId: 'FM-734 @ US-290 EB' });
    expect(A.parseTxdotId('txdot-XXX-1')).toBeNull();
    const nested = A.parseTxdot({ cctvStatusRoadways: [{ ctts: [{ icd_Id: 'X1', latitude: 30, longitude: -97, hasSnapshot: true }, { icd_Id: 'X2', latitude: 30, longitude: -97, hasSnapshot: false }] }] }, 'AUS');
    expect(nested.map((r) => r.id)).toEqual(['txdot-AUS-X1']);
  });

  it('MDOT reads coordinates and ids out of HTML fragments as plain text', () => {
    const rows = A.parseMdot(json(FX.mdot));
    expect(rows).toHaveLength(3);
    expect(valid(rows)).toBe(true);
    expect(rows[0]).toMatchObject({ id: 'mdot-1129', lat: 42.491304, lng: -83.04479, city: 'Wayne County' });
    expect(rows[0]!.name).not.toMatch(/</);
  });

  it('Canada: Ottawa, Québec (link-out), Toronto, DriveBC (operator image time)', () => {
    const ott = A.parseOttawa(json(FX.ottawa));
    expect(ott[0]).toMatchObject({ id: 'ottawa-2025', stillUrl: 'https://traffic.ottawa.ca/map/camera?id=2025' });
    const qc = A.parseQuebec(json(FX.quebec));
    expect(qc[0]).toMatchObject({ id: 'quebec-4057', streamType: 'link', stillUrl: null });
    const tor = A.parseToronto(json(FX.toronto));
    expect(tor[0]).toMatchObject({ id: 'toronto-8001', name: 'YORK ST / BREMNER BLVD / RAPTORS WAY' });
    const bc = A.parseDriveBc(json(FX.drivebc));
    expect(bc[0]).toMatchObject({ id: 'drivebc-967', stillUrl: 'https://www.drivebc.ca/images/967.jpg', observedAt: '2026-09-30T20:00:06.000Z' });
    expect(valid([...ott, ...qc, ...tor, ...bc])).toBe(true);
  });

  it('TfL JamCams: still + latest clip, catalogue id form tfl-<id>', () => {
    const rows = A.parseTfl(json(FX.tfl));
    expect(rows.length).toBeGreaterThan(0);
    expect(valid(rows)).toBe(true);
    expect(rows[0]).toMatchObject({ id: 'tfl-00002.00865', streamType: 'mp4', observedAt: null });
    expect(rows[0]!.streamUrl).toBe('https://s3-eu-west-1.amazonaws.com/jamcams.tfl.gov.uk/00002.00865.mp4');
  });

  it('Europe: DGT (no inventory date as frame time) and RWS (link out)', () => {
    const dgt = A.parseDgt(json(FX.dgt));
    expect(dgt[0]).toMatchObject({ id: 'dgt-2', name: 'A-62 km 57.9', observedAt: null, country: 'ES' });
    const rws = A.parseRws(json(FX.rws));
    expect(rws[0]).toMatchObject({ id: 'rws-4', streamType: 'link', name: 'A1 — Amersfoort' });
    expect(valid([...dgt, ...rws])).toBe(true);
  });

  it('Nordics: Digitraffic (gathering stations only) and Vegagerðin', () => {
    const fi = A.parseDigitraffic(json(FX.digitraffic));
    expect(fi).toHaveLength(3);
    expect(fi[0]).toMatchObject({ id: 'digitraffic-C0150301', stillUrl: 'https://weathercam.digitraffic.fi/C0150301.jpg', name: 'kt51 Inkoo' });
    const is = A.parseVegagerdin(json(FX.vegagerdin));
    expect(is[0]).toMatchObject({ id: 'vegagerdin-hellisheidi_1', country: 'IS' });
    expect(valid([...fi, ...is])).toBe(true);
  });

  it('Trafikverket Camera objects (documented shape) with PhotoTime as observedAt', () => {
    const rows = A.parseTrafikverket({ RESPONSE: { RESULT: [{ Camera: [{ Id: 'SE_STA_CAMERA_Orion_39636115', Name: 'E4 Hallunda', Active: true, Geometry: { WGS84: 'POINT (17.82 59.24)' }, PhotoUrl: 'https://api.trafikinfo.trafikverket.se/v2/Images/data/road.infrastructure.camera/TrafficFlowCamera_39636115.jpg', PhotoTime: '2026-09-30T22:02:05.000+02:00', HasFullSizePhoto: true }] }] } });
    expect(rows[0]).toMatchObject({ lat: 59.24, lng: 17.82, observedAt: '2026-09-30T20:02:05.000Z' });
    expect(rows[0]!.stillUrl).toMatch(/\?type=fullsize$/);
  });

  it('Asia: HK TD XML, LTA with +08:00 timestamps → UTC, THB encoders only', () => {
    const hk = A.parseHongKong(text(FX.hktd));
    expect(hk[0]).toMatchObject({ id: 'hktd-H429F', city: 'Southern', stillUrl: 'https://tdcctv.data.one.gov.hk/H429F.JPG' });
    const sg = A.parseLta(json(FX.lta));
    expect(sg[0]).toMatchObject({ id: 'lta-2701', observedAt: '2026-09-30T20:00:45.000Z' });
    const tw = A.parseThb(json(FX.thb));
    expect(tw).toHaveLength(3); // the Freeway Bureau MJPEG row is dropped
    expect(tw[0]!.stillUrl).toBe('https://cctv-ss03.thb.gov.tw/T1-123K+850/snapshot');
    expect(valid([...hk, ...sg, ...tw])).toBe(true);
  });

  it('Oceania: NZTA skips offline cameras and nested blocks; NSW liveCams only', () => {
    const nz = A.parseNzta(text(FX.nzta));
    expect(nz).toHaveLength(2); // 831 is offline
    expect(nz[0]).toMatchObject({ id: 'nzta-714', city: 'Canterbury', name: 'SH1 Tinwald', headingDeg: 180, externalUrl: 'https://trafficnz.info/camera/view/714' });
    const nsw = A.parseLiveTrafficNsw(json(FX.nsw));
    expect(nsw).toHaveLength(3);
    expect(nsw[0]).toMatchObject({ id: 'nsw-5-ways-miranda', country: 'AU' });
    expect(valid([...nz, ...nsw])).toBe(true);
  });

  it('refuses bad coordinates, non-https frames and zone-less times', () => {
    expect(A.parseDgt({ camaras: [{ id: '1', latitud: '0', longitud: '0', imagen: 'https://etraffic.dgt.es/camarasEtraffic/1.jpg' }] })).toEqual([]);
    expect(A.parseDgt({ camaras: [{ id: '1', latitud: '40', longitud: '-3', imagen: 'http://etraffic.dgt.es/camarasEtraffic/1.jpg' }] })).toEqual([]);
    expect(A.isoWithOffset('2026-09-30 13:00:06')).toBeNull();
    expect(A.isoWithOffset('2026-09-30T13:00:06-07:00')).toBe('2026-09-30T20:00:06.000Z');
  });
});
