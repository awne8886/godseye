/**
 * /privacy — what leaves this instance, where it goes and what is kept. The upstream table is
 * generated from the endpoint catalogue (`upstreamsReceivingUserInput()`), the browser-side hosts
 * from the CSP allow-lists in src/config/hosts.ts, and the storage keys from the client stores,
 * so the page changes when the code does. Static server component.
 * Owner: pages-docs-privacy-ops.
 */
import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { API_CATALOG, upstreamsReceivingUserInput, type ApiEndpoint } from '@/lib/api-catalog';
import { APP_NAME, REPO_URL } from '@/lib/config';
import { THEME_STORAGE_KEY } from '@/lib/theme-boot';
import { FRAME_HOSTS, IMAGE_HOSTS, MEDIA_HOSTS, TILE_HOSTS } from '@/config/hosts';
import { PageShell, SectionTitle, TextLink } from '../docs/chrome';
import s from '../docs/docs.module.css';
import { userInputDisclosures } from '../docs/format';

export const dynamic = 'force-static';

export const metadata: Metadata = {
  title: `Privacy — ${APP_NAME}`,
  description: `What ${APP_NAME} sends to third parties, when, and what the server keeps. Generated from the endpoint catalogue.`,
};

/** Client-side preference keys (src/lib/store.ts persist name, src/lib/theme-boot.ts). */
const SETTINGS_STORAGE_KEY = 'godseye:settings';

const prose = 'mt-3 max-w-3xl text-[13px] leading-relaxed text-fg';

function Code({ children }: { children: ReactNode }) {
  return <code className="font-mono text-fg-heading">{children}</code>;
}

function HostList({ hosts }: { hosts: readonly string[] }) {
  return (
    <ul className="mt-2 flex flex-wrap gap-2">
      {hosts.map((h) => (
        <li key={h} className="rounded border border-[var(--border-primary)] px-2 py-1 font-mono text-[12px] text-fg [overflow-wrap:anywhere]">
          {h.replace(/^https:\/\//, '')}
        </li>
      ))}
    </ul>
  );
}

export default function PrivacyPage() {
  const hosts = upstreamsReceivingUserInput();
  const disclosures = userInputDisclosures(API_CATALOG as readonly ApiEndpoint[], hosts);
  return (
    <PageShell current="privacy">
      <main id="main" tabIndex={-1} className="mx-auto max-w-6xl px-5 py-10 outline-none">
        <p className="hud-micro text-cyan">Generated from the code at build time</p>
        <h1 className="mt-2 font-display text-[28px] font-bold leading-tight text-fg-heading sm:text-[40px]">Privacy</h1>
        <p className={prose}>
          {APP_NAME} is a front end over public data sources. It has no accounts, sets no cookies and runs no analytics or
          tracking scripts. Data panels ask this server, and the server asks the upstream providers with its own IP address and an
          identifying User-Agent. Your IP address is never forwarded to them: the server&apos;s HTTP client refuses to send{' '}
          <Code>X-Forwarded-For</Code>, <Code>X-Real-IP</Code> or <Code>Forwarded</Code> headers.
        </p>

        <section aria-labelledby="leaves" className="mt-8 max-w-3xl rounded-xl border border-[var(--alert-orange)] bg-secondary-bg p-5">
          <h2 id="leaves" className="hud-text text-[13px] text-alert-orange">
            Your query leaves this instance
          </h2>
          <p className="mt-2 text-[13px] leading-relaxed text-fg">
            When you search for a place, look up a domain or IP, plan a route or ask the analyst a question, that value is forwarded
            to the provider that answers it. The provider sees what you searched for, and a search can reveal what you are looking
            into. Self-hosting changes who runs the front end; it does not stop these outbound queries. Each provider applies its own
            privacy policy and retention, which {APP_NAME} does not control.
          </p>
        </section>

        <section aria-labelledby="upstreams" className="mt-12">
          <SectionTitle id="upstreams">Upstreams that receive your input</SectionTitle>
          <p className={prose}>
            Every provider below receives something you typed, selected or clicked. The list is generated from the endpoint catalogue
            ({hosts.length} hosts); the <TextLink href="/docs">API reference</TextLink> shows every endpoint and its upstreams.
            Entries in parentheses are hosts chosen at run time: a public URL you submit, or a scanner backend the operator
            configured. The middle column lists every input of the endpoints that call a provider; an endpoint may forward only
            some of them to each provider, never more.
          </p>
          <table className={`${s.table} mt-5`}>
            <caption className="sr-only">Upstream hosts that receive user input, what is sent and why</caption>
            <colgroup>
              <col className="w-[26%]" />
              <col className="w-[40%]" />
              <col />
            </colgroup>
            <thead>
              <tr>
                <th scope="col">Upstream</th>
                <th scope="col">Input that may be sent</th>
                <th scope="col">When / why</th>
              </tr>
            </thead>
            <tbody>
              {disclosures.map((d) => (
                <tr key={d.host}>
                  <th scope="row">
                    <code className="font-mono text-cyan">{d.host}</code>
                  </th>
                  <td>
                    <ul className="grid gap-1">
                      {[...new Set(d.uses.flatMap((u) => u.sent))].map((s) => (
                        <li key={s}>{s}</li>
                      ))}
                    </ul>
                  </td>
                  <td className="text-fg-secondary">
                    <ul className="grid gap-1">
                      {d.uses.map((u) => (
                        <li key={`${u.method} ${u.path}`}>
                          <code className="font-mono text-fg">{u.path}</code>: {u.summary}
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section aria-labelledby="browser" className="mt-12">
          <SectionTitle id="browser">What your browser loads directly</SectionTitle>
          <p className={prose}>
            The Content-Security-Policy lets your browser contact only this origin and the hosts below. Like any web request, they see
            your IP address and browser User-Agent. Everything else goes through this server.
          </p>
          <div className="mt-5 grid max-w-4xl gap-5 sm:grid-cols-2">
            <div>
              <h3 className="hud-text text-[11px] text-fg-heading">Map tiles, styles and radar tiles</h3>
              <HostList hosts={TILE_HOSTS} />
            </div>
            <div>
              <h3 className="hud-text text-[11px] text-fg-heading">Official video embeds</h3>
              <HostList hosts={FRAME_HOSTS} />
            </div>
            <div>
              <h3 className="hud-text text-[11px] text-fg-heading">Public camera and channel video</h3>
              <HostList hosts={MEDIA_HOSTS} />
            </div>
            <div>
              <h3 className="hud-text text-[11px] text-fg-heading">Thumbnails</h3>
              <p className="mt-1 text-[12px] leading-relaxed text-fg-secondary">
                Normally fetched by this server&apos;s image optimiser; a plain image fallback loads them directly.
              </p>
              <HostList hosts={IMAGE_HOSTS} />
            </div>
          </div>
          <p className={prose}>
            Camera stills never come from these hosts: they pass through a stills-only proxy on this server with an exact-prefix
            allow-list, and no frame is stored.
          </p>
        </section>

        <section aria-labelledby="location" className="mt-12">
          <SectionTitle id="location">Your location</SectionTitle>
          <p className={prose}>
            {APP_NAME} never locates you automatically. Without your consent the map opens on a landing city picked by the UTC
            date, not by where you are. &ldquo;Centre on my region&rdquo; is a one-click choice: only after you make it does <Code>/api/geo</Code> send your IP address, as seen by
            this server, to the geolocation provider listed above. Precise position comes only from your browser&apos;s own
            permission prompt, and the <Code>Permissions-Policy</Code> header limits geolocation to this origin. Your answer is
            remembered in this browser only.
          </p>
        </section>

        <section aria-labelledby="ai" className="mt-12">
          <SectionTitle id="ai">AI analyst and your keys</SectionTitle>
          <p className={prose}>
            AI summaries run only when the operator configured a provider key or you supply your own. A key you supply travels in the{' '}
            <Code>x-ai-key</Code> request header, is used for that one request and is never stored or logged, and the server&apos;s HTTP
            client drops credential headers whenever an upstream redirects to another origin. Operators can refuse visitor keys with{' '}
            <Code>DISABLE_USER_AI_KEYS=true</Code>. The request body (the scope, the feed rows or your chat messages) goes to the
            model provider named in the table above, so do not paste confidential material. Without a model, the heuristic ANALYST
            answers instead and is labelled as a heuristic, not AI. A model summary is not verification: check its claims against the
            cited feeds.
          </p>
        </section>

        <section aria-labelledby="storage" className="mt-12">
          <SectionTitle id="storage">Cookies, analytics and browser storage</SectionTitle>
          <p className={prose}>
            No cookies, no analytics, no advertising or tracking scripts, no fingerprinting. Preferences are kept in your
            browser&apos;s local storage, not on the server:
          </p>
          <ul className="mt-3 grid max-w-3xl list-disc gap-2 pl-5 text-[13px] leading-relaxed text-fg marker:text-gold">
            <li>
              <Code>{SETTINGS_STORAGE_KEY}</Code>: units, motion preference, location consent answer, preview autoplay and preferred AI
              provider.
            </li>
            <li>
              <Code>{THEME_STORAGE_KEY}</Code>: the selected theme.
            </li>
          </ul>
          <p className={prose}>Clearing this site&apos;s data in your browser removes both. The map view is kept in the URL, not in storage.</p>
        </section>

        <section aria-labelledby="retention" className="mt-12">
          <SectionTitle id="retention">What the server keeps</SectionTitle>
          <ul className="mt-3 grid max-w-3xl list-disc gap-2 pl-5 text-[13px] leading-relaxed text-fg marker:text-gold">
            <li>
              Upstream snapshots (aircraft, earthquakes and the other feeds): the last good copy of each feed, kept by default for 24
              hours or twenty refresh intervals, whichever is longer, so a failing source is shown as stale with its last-good time
              instead of empty.
            </li>
            <li>
              Lookup results (OSINT, airports, geocoding): cached under the query that produced them, so a repeated lookup does not hit
              the provider again. Nominatim results are kept for 30 days, as its usage policy asks for caching. Cache entries are
              not linked to who asked.
            </li>
            <li>
              Rate limiting: a request counter per route and client IP address (IPv6 by /64 prefix) that expires with its window,
              usually one minute.
            </li>
            <li>
              Logs: the application keeps no access log and does not log visitor IP addresses; it writes server errors (route and
              error message) to standard error. The bundled Caddy configuration enables no access log; an operator&apos;s own proxy or
              host may keep one.
            </li>
          </ul>
          <p className={prose}>
            Caches live in memory by default, or on disk (<Code>SNAPSHOT_DIR</Code>) or in Redis (<Code>REDIS_URL</Code>) when the
            operator configures them. Camera frames and AI keys are never written anywhere.
          </p>
        </section>

        <section aria-labelledby="cameras" className="mt-12">
          <SectionTitle id="cameras">Public cameras</SectionTitle>
          <p className={prose}>
            Camera layers show official, public traffic and weather cameras for situational awareness. {APP_NAME} does not record,
            archive or run face, plate or object recognition on them, and every camera has a &ldquo;Report / remove this
            camera&rdquo; button. Sources, licences and the takedown path are on the{' '}
            <TextLink href="/cameras-notice">camera notice</TextLink>.
          </p>
        </section>

        <section aria-labelledby="responsible-use" className="mt-12">
          <SectionTitle id="responsible-use">Responsible use</SectionTitle>
          <ul className="mt-3 grid max-w-3xl list-disc gap-2 pl-5 text-[13px] leading-relaxed text-fg marker:text-gold">
            <li>
              Lookups are passive and about infrastructure: domains, IP addresses, certificates, networks, vulnerabilities. There is no
              people search; username, email, phone and identity fingerprinting tools are{' '}
              <TextLink href="/docs#excluded">deliberately not included</TextLink>.
            </li>
            <li>
              Active scanning exists only if the operator connects a separate scanner backend. Scans are restricted to allow-listed
              types and public targets, and are proxied through this server to that backend. They never run from
              your browser. That is a safety floor, not permission: scanning systems you are not authorised to test may be unlawful,
              and obtaining authorisation is your responsibility.
            </li>
            <li>
              Upstream providers are called with an identifying User-Agent and within their published rate limits. Licence-restricted
              sources are off unless the operator enables them.
            </li>
          </ul>
        </section>

        <section aria-labelledby="contact" className="mt-12 mb-4">
          <SectionTitle id="contact">Questions and takedown requests</SectionTitle>
          <p className={prose}>
            This page describes the code of this release. Operators of a self-hosted instance choose its keys, caches and licence
            gates. Report a problem or request a removal on the <TextLink href={`${REPO_URL}/issues`}>issue tracker</TextLink>.
          </p>
        </section>
      </main>
    </PageShell>
  );
}
