/**
 * Columnar camera rows → Camera records (only for the one camera being picked/previewed; the layer
 * itself reads rows by index). Owner: layers-surveillance.
 */
import type { Cell } from '@/lib/columnar';
import { CAMERA_FIELDS } from '@/lib/schemas/surveillance';
import type { Camera } from '@/lib/types';

export const IDX = Object.fromEntries(CAMERA_FIELDS.map((f, i) => [f, i])) as Record<(typeof CAMERA_FIELDS)[number], number>;

export function rowToCamera(row: readonly Cell[]): Camera {
  const s = (i: number) => (typeof row[i] === 'string' ? (row[i] as string) : null);
  return {
    id: String(row[IDX.id]),
    lat: Number(row[IDX.lat]),
    lng: Number(row[IDX.lng]),
    name: s(IDX.name) ?? '',
    providerId: s(IDX.providerId) ?? '',
    city: s(IDX.city),
    country: s(IDX.country),
    streamType: (s(IDX.streamType) ?? 'link') as Camera['streamType'],
    stillUrl: s(IDX.stillUrl),
    streamUrl: s(IDX.streamUrl),
    externalUrl: s(IDX.externalUrl),
    observedAt: s(IDX.observedAt),
    source: s(IDX.source) ?? '',
    headingDeg: null,
  };
}

/** GitHub issue link prefilled for a camera removal request (no server-side storage). */
export function removalUrl(repo: string, c: Pick<Camera, 'id' | 'name' | 'providerId'>, operator: string | null, terms: string | null): string {
  const title = `Camera removal request: ${c.id}`;
  const body = [
    `Camera id: ${c.id}`,
    `Name: ${c.name}`,
    `Operator: ${operator ?? c.providerId}`,
    terms ? `Operator terms: ${terms}` : null,
    '',
    'Reason (e.g. shows private property, a person has asked to be removed, feed is not official):',
    '',
    'GODSEYE does not record, archive or analyse camera frames. See /cameras-notice.',
  ]
    .filter((l) => l !== null)
    .join('\n');
  return `${repo}/issues/new?${new URLSearchParams({ title, body, labels: 'camera-removal' }).toString()}`;
}
