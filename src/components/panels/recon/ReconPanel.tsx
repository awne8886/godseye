'use client';
/**
 * RECON: passive OSINT on infrastructure. One target box (domain, IP, ASN, CVE, MAC, wallet, URL,
 * hash) fans out to the matching /api/osint/* lookups; each result card names the providers that
 * answered (with age), the ones that failed or were skipped, and the transparent findings. Also:
 * passive /28–/32 sweep (InternetDB data, no packets sent), OFAC SDN name search, the optional
 * scanner backend (only when the operator configured one; proxied through this server), and JSON
 * export of everything shown. Owner: panels-recon.
 */
import { ChevronDown, ChevronRight, Download, Radar, ScanLine, Search, ShieldAlert } from 'lucide-react';
import { useId, useState } from 'react';
import { useHealth } from '@/components/hud/hooks';
import { usePanelChip } from '@/components/hud/PanelChrome';
import type { PanelProps } from '@/lib/feature-module';
import type { OsintResponse, Providers } from '@/lib/types';
import { ErrorLine, Findings, HudButton, HudInput, KeyValues, Label, ProviderChips, Prose, SectionTitle, apiGet, downloadJson } from './ui';
import { planLookups, type Lookup } from './plan';

type Result = { lookup: Lookup; ok: boolean; status: number; body: Partial<OsintResponse> & { error?: string; detail?: string; providers?: Providers } };

function ResultCard({ r }: { r: Result }) {
  const [open, setOpen] = useState(true);
  const b = r.body;
  const id = useId();
  return (
    <section aria-labelledby={id} className="rounded-md border border-[var(--border-secondary)] px-2.5 py-2" data-testid={`recon-result-${r.lookup.tool}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-1.5 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
      >
        {open ? <ChevronDown size={13} aria-hidden /> : <ChevronRight size={13} aria-hidden />}
        <h3 id={id} className="flex-1 font-mono text-[11px] uppercase tracking-[0.08em] text-[var(--text-heading)]">
          {r.lookup.label}
        </h3>
        <span className="font-mono text-[10px] uppercase tracking-[0.16em]" style={{ color: r.ok ? 'var(--alert-green)' : 'var(--alert-orange)' }}>
          {r.ok ? `${b.findings?.length ?? 0} findings` : r.status === 503 ? 'offline' : `error ${r.status}`}
        </span>
      </button>
      {open && (
        <div className="mt-1.5 flex flex-col gap-2">
          <ProviderChips providers={b.providers} at={r.ok ? b.timestamp : null} />
          {!r.ok && <ErrorLine error={b.error} detail={b.detail} />}
          {r.ok && b.findings && <Findings items={b.findings} />}
          {r.ok && b.data && <KeyValues data={b.data} />}
        </div>
      )}
    </section>
  );
}

export default function ReconPanel(_: PanelProps) {
  const health = useHealth();
  const caps = health.data?.capabilities;
  const [target, setTarget] = useState('');
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState(false);
  const [refusal, setRefusal] = useState<string | null>(null);
  const [cidr, setCidr] = useState(30);
  const [sdnQ, setSdnQ] = useState('');
  const [scanType, setScanType] = useState('ssl');
  const targetId = useId();
  const sdnId = useId();
  const scanId = useId();
  const ok = results.filter((r) => r.ok).length;
  usePanelChip(busy ? 'QUERYING' : results.length ? `${ok}/${results.length} ANSWERED` : 'STANDBY', busy ? 'busy' : results.length ? (ok === results.length ? 'live' : 'warn') : 'idle');

  const run = async (lookups: Lookup[], append = false) => {
    setBusy(true);
    const out = await Promise.all(
      lookups.map(async (lookup) => {
        try {
          const r = await apiGet<OsintResponse>(lookup.path);
          return { lookup, ...r } as Result;
        } catch {
          return { lookup, ok: false, status: 0, body: { error: 'network_error', detail: 'Could not reach this server.' } } as Result;
        }
      }),
    );
    setResults(append ? [...results, ...out] : out);
    setBusy(false);
  };

  const plan = planLookups(target);
  const onSubmit = () => {
    if (!plan.ok) {
      setRefusal(plan.reason);
      return;
    }
    setRefusal(null);
    void run(plan.lookups);
  };

  const scannerOn = caps?.scanner?.enabled === true;
  const activeOn = caps?.scanner_active?.enabled === true;

  return (
    <div className="flex flex-col gap-3" data-testid="recon-panel">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          onSubmit();
        }}
        className="flex flex-col gap-1"
      >
        <Label htmlFor={targetId}>Target</Label>
        <div className="flex gap-1.5">
          <HudInput id={targetId} value={target} onChange={(e) => setTarget(e.target.value)} placeholder="domain · IP · ASN · CVE" title="e.g. example.com, 1.1.1.1, AS15169, CVE-2024-3400" maxLength={2048} autoFocus />
          <HudButton type="submit" aria-label="Run lookups" disabled={busy}>
            <Search size={14} aria-hidden />
          </HudButton>
        </div>
        <Prose>Passive lookups on infrastructure only, run by this server against public sources. Email addresses, phone numbers and usernames are not looked up.</Prose>
      </form>
      {refusal && (
        <p role="alert" className="flex items-start gap-1.5 font-sans text-[12px] text-[var(--alert-orange)]">
          <ShieldAlert size={14} className="mt-0.5 shrink-0" aria-hidden /> {refusal}
        </p>
      )}
      {plan.ok && plan.kind === 'ip' && /^\d/.test(plan.target) && (
        <div className="flex flex-wrap items-center gap-1.5">
          <Label>Passive sweep</Label>
          {[28, 29, 30, 31, 32].map((c) => (
            <HudButton key={c} tone="muted" pressed={cidr === c} onClick={() => setCidr(c)}>
              /{c}
            </HudButton>
          ))}
          <HudButton tone="cyan" disabled={busy} onClick={() => void run([{ tool: 'sweep', label: `Sweep ${plan.target}/${cidr}`, path: `/api/osint/sweep?ip=${encodeURIComponent(plan.target)}&cidr=${cidr}` }], true)}>
            <Radar size={14} aria-hidden /> Sweep
          </HudButton>
        </div>
      )}
      {results.length > 0 && (
        <div className="flex items-center gap-2">
          <SectionTitle>Results</SectionTitle>
          <HudButton tone="muted" onClick={() => downloadJson(`godseye-recon-${Date.now()}.json`, results.map((r) => ({ lookup: r.lookup.path, status: r.status, ...r.body })))}>
            <Download size={13} aria-hidden /> JSON
          </HudButton>
        </div>
      )}
      <div className="flex flex-col gap-2" aria-live="polite">
        {results.map((r, i) => (
          <ResultCard key={`${r.lookup.path}-${i}`} r={r} />
        ))}
      </div>
      <form
        className="flex flex-col gap-1 border-t border-[var(--border-secondary)] pt-2"
        onSubmit={(e) => {
          e.preventDefault();
          if (sdnQ.trim().length >= 2) void run([{ tool: 'sanctions', label: `OFAC SDN: ${sdnQ.trim()}`, path: `/api/osint/sanctions?q=${encodeURIComponent(sdnQ.trim())}` }], true);
        }}
      >
        <Label htmlFor={sdnId}>Sanctions (OFAC SDN: entity, vessel, company)</Label>
        <div className="flex gap-1.5">
          <HudInput id={sdnId} value={sdnQ} onChange={(e) => setSdnQ(e.target.value)} placeholder="Rosneft" maxLength={120} />
          <HudButton type="submit" aria-label="Search sanctions list" disabled={busy}>
            <Search size={14} aria-hidden />
          </HudButton>
        </div>
      </form>
      {scannerOn && (
        <form
          className="flex flex-col gap-1 border-t border-[var(--border-secondary)] pt-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (plan.ok) void run([{ tool: 'scanner', label: `Scanner: ${scanType}`, path: `/api/scanner?type=${scanType}&target=${encodeURIComponent(plan.target.replace(/^https?:\/\//, '').split('/')[0]!)}` }], true);
          }}
        >
          <Label htmlFor={scanId}>Scanner (proxied through this server)</Label>
          <div className="flex gap-1.5">
            <select
              id={scanId}
              value={scanType}
              onChange={(e) => setScanType(e.target.value)}
              className="min-h-9 flex-1 rounded-md border border-[var(--border-secondary)] bg-[var(--bg-void)] px-2 font-mono text-[11px] uppercase text-[var(--text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--gold-primary)]"
            >
              {['ssl', 'headers', 'rdns', 'subdomains', 'tech', 'whois', 'geoloc', ...(activeOn ? ['quick', 'vuln'] : [])].map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
            <HudButton type="submit" tone="cyan" disabled={busy || !plan.ok}>
              <ScanLine size={14} aria-hidden /> Scan
            </HudButton>
          </div>
          <Prose>
            Runs on this deployment&rsquo;s scanner backend, not from your browser. {activeOn ? 'Active scan types (quick, vuln) send packets to the target: scan only systems you are authorised to test.' : 'Only passive scan types are enabled.'}
          </Prose>
        </form>
      )}
    </div>
  );
}
