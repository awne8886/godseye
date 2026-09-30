'use client';
/**
 * UI state for the camera viewer and live-news panel (which camera/channel is open). Small records
 * only; the catalogue itself never lives in zustand. Owner: layers-surveillance.
 */
import { create } from 'zustand';
import { useSelectionStore } from '@/lib/layer-host';
import { useUiStore } from '@/lib/store';
import type { Camera, NewsChannel } from '@/lib/types';

interface SurveillanceUi {
  camera: Camera | null;
  channel: NewsChannel | null;
  setCamera: (c: Camera | null) => void;
  setChannel: (c: NewsChannel | null) => void;
}

export const useSurveillanceUi = create<SurveillanceUi>((set) => ({
  camera: null,
  channel: null,
  setCamera: (camera) => set({ camera }),
  setChannel: (channel) => set({ channel }),
}));

export function openCameraViewer(c: Camera): void {
  useSurveillanceUi.getState().setCamera(c);
  useUiStore.getState().setOpenPanel('camera');
}

export function openLiveNews(c: NewsChannel | null): void {
  useSurveillanceUi.getState().setChannel(c);
  useUiStore.getState().setOpenPanel('live-news');
}

export function selectCamera(c: Camera): void {
  useSelectionStore.getState().select({ kind: 'camera', id: c.id, layer: 'cctv', source: c.source, observedAt: c.observedAt, data: c as unknown as Record<string, unknown>, lngLat: [c.lng, c.lat] });
}

export function selectChannel(c: NewsChannel): void {
  useSelectionStore.getState().select({ kind: 'news_channel', id: c.id, layer: 'live_news', source: c.source, observedAt: c.observedAt, data: c as unknown as Record<string, unknown>, lngLat: [c.lng, c.lat] });
}
