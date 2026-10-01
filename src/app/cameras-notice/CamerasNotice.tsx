/**
 * Body of /cameras-notice — the notice for people who may appear in the public camera feeds GODSEYE shows
 * (§0.7, GDPR Art. 13/14-style): purpose, sources, what is and is not done with frames, the
 * link-out-only mode, and how to have a camera removed. The operator table is generated from the
 * provider registry, so it changes when the code does. Rendered per request because two lines depend
 * on this instance's environment: which keyed operators are configured, and GODSEYE_CONTACT (the
 * operator of this instance handles removals).
 * Owner: layers-surveillance.
 */
import Link from 'next/link';
import type { ReactNode } from 'react';
import { NOT_WIRED_SOURCES, PROVIDERS } from '@/features/surveillance/server/registry';
import { removalContact, removalHref } from '@/features/surveillance/shared';
import { hasCapability } from '@/lib/capabilities';
import { APP_NAME } from '@/lib/config';

const REQUEST_BODY = 'Camera id (from the viewer):\nOperator:\nReason:\n';


function H2({ id, children }: { id: string; children: ReactNode }) {
  return (
    <h2 id={id} className="mt-10 scroll-mt-4 font-mono text-[13px] uppercase tracking-[.22em] text-[var(--gold-primary)]">
      {children}
    </h2>
  );
}

const prose = 'mt-3 max-w-3xl font-sans text-[13px] leading-relaxed text-[var(--text-primary)]';
const link = 'text-[var(--gold-light)] underline underline-offset-2 hover:text-[var(--gold-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]';

export default function CamerasNotice({ env }: { env: Record<string, string | undefined> }) {
  const rows = PROVIDERS.map((p) => ({ ...p.row, configured: !p.capability || hasCapability(p.capability, env) }));
  const contact = removalContact(env);
  return (
    <div className="fixed inset-0 overflow-y-auto bg-[var(--bg-primary)] text-[var(--text-primary)]">
      <header className="border-b border-[var(--border-primary)] bg-[var(--bg-void)]">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-5 py-4">
          <Link href="/" prefetch={false} className={`font-mono text-[17px] font-bold tracking-[.3em] text-[var(--gold-primary)] ${link.replace('underline ', '')}`}>
            {APP_NAME}
          </Link>
          <nav aria-label="Pages" className="flex gap-4 font-mono text-[11px] uppercase tracking-[.08em]">
            <Link href="/privacy" prefetch={false} className={link}>
              Privacy
            </Link>
            <Link href="/docs" prefetch={false} className={link}>
              Docs
            </Link>
          </nav>
        </div>
      </header>
      <main id="main" className="mx-auto max-w-5xl px-5 pb-16 pt-8">
        <h1 className="font-mono text-[28px] uppercase tracking-[.08em] text-[var(--text-heading)]">Cameras notice</h1>
        <p className={prose}>
          {APP_NAME} shows still images and video from <strong>official public traffic and road-weather cameras</strong> published by transport agencies. This page explains why, what we do not do,
          and how anyone who appears in a feed — or any operator — can have a camera removed.
        </p>

        <H2 id="purpose">Purpose</H2>
        <p className={prose}>
          Situational and traffic awareness: road, weather and incident conditions on public roads, shown next to the other public data on the map. Cameras are not used to watch, find or identify
          people.
        </p>

        <H2 id="not-done">What we do not do</H2>
        <ul className={`${prose} list-disc pl-5`}>
          <li>No recording and no archiving: frames are relayed from the operator when you open them and are never stored on our servers.</li>
          <li>No face, licence-plate or object recognition, and no enhancement, zoom or re-identification of any frame.</li>
          <li>No private, unsecured or &ldquo;default password&rdquo; cameras (no Insecam/Opentopia-type directories), no scraping of sites whose terms forbid it (OpenCCTV, SkylineWebcams, EarthCam frames).</li>
          <li>No spoofed headers: requests identify {APP_NAME} honestly and respect each operator&apos;s minimum refresh interval.</li>
        </ul>

        <H2 id="sources">Sources</H2>
        <p className={prose}>Every camera comes from one of these operators, under the licence and terms shown. The operator remains the controller of its cameras.</p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <caption className="sr-only">Camera operators, licences and terms</caption>
            <thead>
              <tr className="font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-muted)]">
                <th scope="col" className="border-b border-[var(--border-primary)] py-2 pr-3">Operator</th>
                <th scope="col" className="border-b border-[var(--border-primary)] py-2 pr-3">Licence</th>
                <th scope="col" className="border-b border-[var(--border-primary)] py-2 pr-3">Mode</th>
                <th scope="col" className="border-b border-[var(--border-primary)] py-2">Terms</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((p) => (
                <tr key={p.id} className="align-top font-sans text-[12px]">
                  <th scope="row" className="border-b border-white/5 py-2 pr-3 font-normal text-[var(--text-heading)]">
                    {p.operator}
                    <span className="block font-mono text-[10px] uppercase tracking-[.16em] text-[var(--text-muted)]">
                      {p.region}, {p.country}
                      {p.key_required ? (p.configured ? ' · operator key configured' : ' · needs operator key (not configured here)') : ''}
                    </span>
                  </th>
                  <td className="border-b border-white/5 py-2 pr-3 text-[var(--text-secondary)]">{p.licence}</td>
                  <td className="whitespace-nowrap border-b border-white/5 py-2 pr-3 text-[var(--text-secondary)]">{p.link_out_only ? 'Link out only' : `Stills ≥ ${p.max_poll_interval} s`}</td>
                  <td className="border-b border-white/5 py-2">
                    <a href={p.terms_url} target="_blank" rel="noopener noreferrer" className={link}>
                      {new URL(p.terms_url).hostname}
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <H2 id="not-wired">Sources not included</H2>
        <p className={prose}>These camera sources are used by similar tools but are not wired here, for the reason shown (checked on the date given). None of their cameras appear on the map.</p>
        <ul className={`${prose} list-disc pl-5`}>
          {NOT_WIRED_SOURCES.map((s) => (
            <li key={s.id} className="mt-1">
              <strong className="font-normal text-[var(--text-heading)]">{s.operator}</strong>{' '}
              <span className="text-[var(--text-muted)]">
                ({s.region}, {s.country})
              </span>
              : <span className="text-[var(--text-secondary)]">{s.reason}</span> <span className="font-mono text-[10px] text-[var(--text-muted)]">CHECKED {s.probedAt}</span>
            </li>
          ))}
        </ul>

        <H2 id="link-out">Link-out-only mode</H2>
        <p className={prose}>
          An operator of this instance can switch whole regions or countries to link-out-only (environment variable <code className="font-mono">CCTV_LINK_OUT_ONLY</code>, e.g.{' '}
          <code className="font-mono">uk,europe</code> or <code className="font-mono">GB,NL</code>). Cameras there show no frames in {APP_NAME}; they open the operator&apos;s own page instead.
        </p>

        <H2 id="removal">Report or remove a camera</H2>
        <p className={prose}>
          {APP_NAME} is open source and self-hosted: the operator of this instance handles removals for it. Every camera card and viewer has a <strong>Report / remove this camera</strong> link,
          and nothing about the request is stored by {APP_NAME} itself.{' '}
          {contact.kind === 'tracker'
            ? `This instance has not published a contact (GODSEYE_CONTACT), so the link opens a prefilled public issue on the ${APP_NAME} project tracker; confirmed cameras are withdrawn from the project's catalogue, which instances receive when they update.`
            : `Requests go to the contact this instance's operator has published (${contact.kind === 'email' ? contact.href.replace(/^mailto:/, '') : contact.href}); the operator withdraws a camera as soon as a request is confirmed.`}{' '}
          The camera itself is controlled by its operator (the terms link above).
        </p>
        <p className={prose}>
          <a href={removalHref(contact, 'Camera removal request', REQUEST_BODY)} target="_blank" rel="noopener noreferrer" className={link} data-testid="removal-request">
            Open a removal request
          </a>
        </p>

        <H2 id="rights">Your rights</H2>
        <p className={prose}>
          If you believe you are identifiable in a feed, you may ask us to stop showing that camera (above) and you may exercise your data-protection rights with the operator, which records and
          publishes the images. {APP_NAME} holds no images of you to access, correct or erase.
        </p>
      </main>
    </div>
  );
}
