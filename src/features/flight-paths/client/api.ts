/**
 * Browser fetchers + react-query hooks for the Flight Path Planner. Responses are typed from the
 * shared zod schemas; errors keep the server's `{error, detail}` so the panel can say exactly
 * what failed (unknown airport, source offline with last-good time). Client-only.
 */
'use client';
import { useQuery } from '@tanstack/react-query';
import type { z } from 'zod';
import type { AirportSearchResponse, FlightDetailResponse, RouteLiveResponse, RoutePlanResponse } from '@/lib/schemas/flight-paths';
import type { FeedMeta } from '@/lib/types';
import { hasPendingProvider } from '../lib/pending';

export type Plan = z.infer<typeof RoutePlanResponse>;
export type Live = z.infer<typeof RouteLiveResponse> & { meta?: FeedMeta };
export type Flight = z.infer<typeof FlightDetailResponse>;
export type Search = z.infer<typeof AirportSearchResponse>;

export class ApiFailure extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    readonly detail: string | null,
    readonly meta: FeedMeta | null = null,
  ) {
    super(detail ?? code);
  }
}

export async function getJson<T>(url: string, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { signal, headers: { accept: 'application/json' } });
  const body = (await res.json().catch(() => null)) as (T & { error?: string; detail?: string; meta?: FeedMeta }) | null;
  if (!res.ok || !body) throw new ApiFailure(res.status, body?.error ?? `http_${res.status}`, body?.detail ?? null, body?.meta ?? null);
  return body;
}

export const planUrl = (from: string, to: string) => `/api/route/plan?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
export const liveUrl = (from: string, to: string) => `/api/route/live?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&reverse=1`;
export const flightUrl = (ident: string) => `/api/flight/${encodeURIComponent(ident)}`;
export const searchUrl = (q: string, all: boolean, submit = false) => `/api/airports/search?q=${encodeURIComponent(q)}${all ? '&all=1' : ''}${submit ? '&submit=1' : ''}`;

const noRetry4xx = (n: number, e: unknown) => !(e instanceof ApiFailure && e.status >= 400 && e.status < 500) && n < 2;

/** Re-ask while a plan provider is pending (the server answers from cache once the refresh lands). */
export const PLAN_PENDING_POLL_MS = 5_000;

export function usePlan(route: { from: string; to: string } | null) {
  return useQuery({
    queryKey: ['route-plan', route?.from, route?.to],
    queryFn: ({ signal }) => getJson<Plan>(planUrl(route!.from, route!.to), signal),
    enabled: !!route,
    staleTime: 5 * 60_000,
    // Poll only while a provider (AeroAPI filed route) is still loading server-side.
    refetchInterval: (q) => (q.state.data && hasPendingProvider(q.state.data.providers) ? PLAN_PENDING_POLL_MS : false),
    retry: noRetry4xx,
  });
}

export function useLive(route: { from: string; to: string } | null, enabled: boolean) {
  return useQuery({
    queryKey: ['route-live', route?.from, route?.to],
    queryFn: ({ signal }) => getJson<Live>(liveUrl(route!.from, route!.to), signal),
    enabled: !!route && enabled,
    refetchInterval: 15_000,
    staleTime: 10_000,
    retry: noRetry4xx,
  });
}

export function useFlight(ident: string | null) {
  return useQuery({
    queryKey: ['flight', ident],
    queryFn: ({ signal }) => getJson<Flight>(flightUrl(ident!), signal),
    enabled: !!ident,
    refetchInterval: 60_000,
    staleTime: 30_000,
    retry: noRetry4xx,
  });
}

export function useAirportSearch(q: string, all: boolean) {
  const query = q.trim();
  return useQuery({
    queryKey: ['airport-search', query.toUpperCase(), all],
    queryFn: ({ signal }) => getJson<Search>(searchUrl(query, all), signal),
    enabled: query.length >= 2,
    staleTime: 10 * 60_000,
    retry: false,
  });
}
