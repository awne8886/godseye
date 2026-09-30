/**
 * /cameras-notice — who may appear in the public camera feeds, what GODSEYE does and does not do
 * with them, and how to have a camera removed (§0.7). Rendered per request: the keyed-operator
 * lines and the removal contact (GODSEYE_CONTACT) depend on this instance's environment.
 * Owner: layers-surveillance.
 */
import type { Metadata } from 'next';
import { APP_NAME } from '@/lib/config';
import CamerasNotice from './CamerasNotice';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: `Cameras notice — ${APP_NAME}`,
  description: `Why ${APP_NAME} shows public traffic cameras, what it does not do with them, and how to have a camera removed.`,
};

export default function CamerasNoticePage() {
  return <CamerasNotice env={process.env} />;
}
