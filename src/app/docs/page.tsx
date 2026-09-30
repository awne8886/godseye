/**
 * /docs — API reference generated at build time from the typed endpoint catalogue
 * (src/lib/api-catalog.ts), the capability table (src/lib/capabilities.ts) and the default
 * per-route rate limit. docs/API.md is generated from the same sources by tools/gen-api-docs.ts.
 * Static server component: no client JavaScript of its own.
 * Owner: pages-docs-privacy-ops.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { API_CATALOG, EXCLUDED_OSIRIS_ROUTES, type ApiEndpoint } from '@/lib/api-catalog';
import { CAPABILITIES, type CapabilityId, type CapabilitySpec } from '@/lib/capabilities';
import { APP_NAME } from '@/lib/config';
import { DEFAULT_LIMIT } from '@/lib/ratelimit';
import { PageShell, SectionTitle, TextLink } from './chrome';
import s from './docs.module.css';
import {
  GROUP_META,
  anchorId,
  capabilityCondition,
  exampleHref,
  formatCache,
  formatParamType,
  formatRateLimit,
  formatStream,
  groupEndpoints,
} from './format';

export const dynamic = 'force-static';

const CATALOG = API_CATALOG as readonly ApiEndpoint[];
const CAPS = CAPABILITIES as Record<CapabilityId, CapabilitySpec>;

export const metadata: Metadata = {
  title: `API reference — ${APP_NAME}`,
  description: `Every ${APP_NAME} endpoint (${CATALOG.length}), generated from the typed catalogue: parameters, cache TTLs, rate limits, capability gates and the upstreams each one calls. No API key required.`,
};

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function MethodBadge({ method }: { method: ApiEndpoint['method'] }) {
  const tone = method === 'GET' ? 'border-[var(--border-cyan)] text-cyan' : 'border-[var(--border-active)] text-gold-light';
  return <span className={`hud-text shrink-0 rounded border px-1.5 py-0.5 text-[11px] ${tone}`}>{method}</span>;
}

function Endpoint({ e }: { e: ApiEndpoint }) {
  const id = anchorId(e);
  const href = exampleHref(e);
  const stream = formatStream(e);
  const spec = e.capability ? CAPS[e.capability] : undefined;
  return (
    <article id={id} aria-labelledby={`${id}-title`} className="glass-panel scroll-mt-4 p-4 sm:p-5">
      <h3 id={`${id}-title`} className="flex min-w-0 flex-wrap items-center gap-2">
        <MethodBadge method={e.method} />
        <code className="font-mono text-[13px] text-fg-heading [overflow-wrap:anywhere]">{e.path}</code>
      </h3>
      <p className="mt-2 text-[13px] leading-relaxed text-fg">{e.summary}</p>
      <dl className={s.meta}>
        <Meta label="Cache">{formatCache(e)}</Meta>
        <Meta label="Rate limit">{formatRateLimit(e, DEFAULT_LIMIT)}</Meta>
        {stream && <Meta label="Stream">{stream}</Meta>}
        <Meta label="Response">
          <code className="font-mono">{e.responseSchema}</code>
        </Meta>
        {e.capability && spec && (
          <Meta label="Capability">
            <code className="font-mono text-gold-light">{e.capability}</code> — {capabilityCondition(e.capability, spec)}. {spec.note}.
          </Meta>
        )}
        <Meta label="Upstreams">{e.upstreams.length ? e.upstreams.join(', ') : 'None: served from this server only'}</Meta>
        <Meta label="Forwards your input upstream">
          {e.forwardsUserInput ? (
            <>
              Yes — see <TextLink href="/privacy#upstreams">Privacy</TextLink>
            </>
          ) : (
            'No'
          )}
        </Meta>
        {'aliases' in e && e.aliases?.length ? <Meta label="Aliases">{e.aliases.join(', ')}</Meta> : null}
        {e.osiris && <Meta label="Compatibility">Same path as the OSIRIS endpoint</Meta>}
      </dl>
      {e.params.length > 0 ? (
        <table className={`${s.table} mt-4`}>
          <caption className="sr-only">Parameters for {e.method} {e.path}</caption>
          <colgroup>
            <col className="w-[31%] sm:w-[27%]" />
            <col className="w-[31%] sm:w-[28%]" />
            <col />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Parameter</th>
              <th scope="col">Type</th>
              <th scope="col">Description</th>
            </tr>
          </thead>
          <tbody>
            {e.params.map((p) => (
              <tr key={`${p.in}:${p.name}`}>
                <th scope="row">
                  <code className="font-mono text-fg-heading">{p.name}</code>
                  <span className={s.sub}>
                    {p.in} · {p.required ? 'required' : 'optional'}
                  </span>
                </th>
                <td className="font-mono text-fg-secondary">{formatParamType(p)}</td>
                <td>
                  {p.description}
                  {p.example && (
                    <span className={s.sub}>
                      e.g. <code className="font-mono">{p.example}</code>
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="mt-4 text-[12px] text-fg-secondary">No parameters.</p>
      )}
      {href && (
        <p className="mt-4 text-[12px]">
          <span className="hud-micro mr-2 text-fg-muted">Example</span>
          <a
            href={href}
            className="font-mono text-cyan underline decoration-[var(--cyan-dim)] underline-offset-4 [overflow-wrap:anywhere] hover:decoration-[var(--cyan-primary)]"
          >
            GET {href}
          </a>
        </p>
      )}
    </article>
  );
}

export default function DocsPage() {
  const groups = groupEndpoints(CATALOG);
  const capIds = Object.keys(CAPS) as CapabilityId[];
  return (
    <PageShell current="docs">
      <div className="mx-auto max-w-6xl px-5 py-10 lg:grid lg:grid-cols-[220px_minmax(0,1fr)] lg:gap-10">
        <nav aria-label="API sections" className="mb-8 lg:sticky lg:top-6 lg:mb-0 lg:self-start">
          <p className="hud-title">Contents</p>
          <ul className="mt-3 grid grid-cols-2 gap-x-4 text-[13px] sm:grid-cols-3 lg:grid-cols-1">
            <li>
              <a className="flex min-h-11 items-center text-fg-secondary hover:text-gold-light lg:min-h-8" href="#conventions">
                Conventions
              </a>
            </li>
            {groups.map(([g, list]) => (
              <li key={g}>
                <a className="flex min-h-11 items-center justify-between gap-2 text-fg-secondary hover:text-gold-light lg:min-h-8" href={`#group-${g}`}>
                  <span>{GROUP_META[g].title}</span>
                  <span className="font-mono text-[11px] text-fg-muted">{list.length}</span>
                </a>
              </li>
            ))}
            <li>
              <a className="flex min-h-11 items-center text-fg-secondary hover:text-gold-light lg:min-h-8" href="#capabilities">
                Capabilities
              </a>
            </li>
            <li>
              <a className="flex min-h-11 items-center text-fg-secondary hover:text-gold-light lg:min-h-8" href="#excluded">
                Not replicated
              </a>
            </li>
          </ul>
        </nav>

        <main id="main" tabIndex={-1} className="min-w-0 outline-none">
          <p className="hud-micro text-cyan">Generated from the endpoint catalogue at build time</p>
          <h1 className="mt-2 font-display text-[28px] font-bold leading-tight text-fg-heading sm:text-[40px]">API reference</h1>
          <p className="mt-4 max-w-3xl text-[13px] leading-relaxed text-fg">
            {CATALOG.length} endpoints, all on this origin and all usable without an API key. Keys configured by the operator only
            unlock upgrades, listed below as capabilities and reported live at{' '}
            <a className="font-mono text-cyan underline decoration-[var(--cyan-dim)] underline-offset-4" href="/api/health">
              /api/health
            </a>
            . The same catalogue drives the route tests, the rate limits and the <TextLink href="/privacy">Privacy</TextLink> page, so
            this reference cannot silently drift from the code.
          </p>

          <section aria-labelledby="conventions" className="mt-10">
            <SectionTitle id="conventions">Conventions</SectionTitle>
            <ul className="mt-4 grid max-w-3xl list-disc gap-2 pl-5 text-[13px] leading-relaxed text-fg marker:text-gold">
              <li>
                Feed responses carry <code className="font-mono text-fg-heading">meta</code> (feed, kind, state, fetchedAt, observedAt,
                lastGoodAt, stale) and <code className="font-mono text-fg-heading">providers</code>, one{' '}
                <code className="font-mono text-fg-heading">{'{ok, count, ms, age_s}'}</code> entry per upstream. Observation time and
                fetch time are always separate fields.
              </li>
              <li>
                A feed that has never produced data answers <code className="font-mono text-fg-heading">503 source_offline</code> with{' '}
                <code className="font-mono text-fg-heading">Retry-After: 30</code> and its provider status — never an empty list
                pretending to be current.
              </li>
              <li>
                Errors are <code className="font-mono text-fg-heading">{'{error, detail}'}</code>:{' '}
                <code className="font-mono">400 invalid_request</code>, <code className="font-mono">429 rate_limited</code> (with{' '}
                <code className="font-mono">Retry-After</code> and <code className="font-mono">X-RateLimit-Limit</code>) and{' '}
                <code className="font-mono">500 internal_error</code> without stack traces.
              </li>
              <li>
                GET responses send <code className="font-mono">Cache-Control: public, s-maxage=TTL, stale-while-revalidate=2×TTL</code>{' '}
                and weak ETags; <code className="font-mono">If-None-Match</code> returns 304. Snapshots served after a failed refresh get
                an edge TTL of at most 15 s.
              </li>
              <li>
                Bulk layers (aircraft, satellites, cameras) are columnar <code className="font-mono">{'{fields, rows}'}</code>,
                precompressed with brotli or gzip, and every default response stays under 4 MB.
              </li>
              <li>
                Rate limits are per route and per client IP as verified by the deployment&apos;s proxy; AI routes share one bucket.
                Timestamps are ISO-8601 UTC.
              </li>
            </ul>
          </section>

          {groups.map(([g, list]) => (
            <section key={g} aria-labelledby={`group-${g}`} className="mt-12">
              <SectionTitle id={`group-${g}`}>{GROUP_META[g].title}</SectionTitle>
              <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-fg-secondary">{GROUP_META[g].blurb}</p>
              <div className="mt-5 grid gap-4">
                {list.map((e) => (
                  <Endpoint key={`${e.method} ${e.path}`} e={e} />
                ))}
              </div>
            </section>
          ))}

          <section aria-labelledby="capabilities" className="mt-12">
            <SectionTitle id="capabilities">Capabilities</SectionTitle>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-fg-secondary">
              Optional upgrades and licence gates, evaluated on the server from environment variables. None is required; the
              interface hides whatever is off. Current values: <code className="font-mono">/api/health</code> →{' '}
              <code className="font-mono">capabilities</code>.
            </p>
            <table className={`${s.table} mt-5`}>
              <caption className="sr-only">Capabilities and the environment that enables them</caption>
              <colgroup>
                <col className="w-[24%]" />
                <col className="w-[38%]" />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Capability</th>
                  <th scope="col">Enabled when</th>
                  <th scope="col">Unlocks</th>
                </tr>
              </thead>
              <tbody>
                {capIds.map((id) => (
                  <tr key={id}>
                    <th scope="row">
                      <code className="font-mono text-gold-light">{id}</code>
                    </th>
                    <td className="font-mono text-fg-secondary">{capabilityCondition(id, CAPS[id])}</td>
                    <td>{CAPS[id].note}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          <section aria-labelledby="excluded" className="mt-12">
            <SectionTitle id="excluded">Not replicated</SectionTitle>
            <p className="mt-2 max-w-3xl text-[13px] leading-relaxed text-fg-secondary">
              OSIRIS endpoints that {APP_NAME} deliberately does not provide, and why.
            </p>
            <table className={`${s.table} mt-5`}>
              <caption className="sr-only">Excluded OSIRIS routes and reasons</caption>
              <colgroup>
                <col className="w-[34%]" />
                <col />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Path</th>
                  <th scope="col">Reason</th>
                </tr>
              </thead>
              <tbody>
                {EXCLUDED_OSIRIS_ROUTES.map((r) => (
                  <tr key={r.path}>
                    <th scope="row">
                      <code className="font-mono text-fg-heading">{r.path}</code>
                    </th>
                    <td>{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </main>
      </div>
    </PageShell>
  );
}
