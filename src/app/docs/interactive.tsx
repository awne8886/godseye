'use client';
/**
 * The one client island on /docs: reading progress, scroll-spy on the section nav, the ⌘K
 * endpoint palette and the "Send request" console. The reference itself stays server-rendered
 * (readable without JavaScript); this component only reads the DOM it is given and adds dialogs.
 *
 * The console calls GET endpoints of THIS origin only: URLs come from `buildTryUrl()` (catalogue
 * path + percent-encoded values, origin and /api/ prefix re-checked), `credentials: 'same-origin'`,
 * no custom headers, nothing stored. Stream endpoints show their first three events, then the
 * console closes the stream.
 * Owner: pages-docs-privacy-ops.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type FormEvent, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { matchBinding } from '@/lib/keyboard';
import s from './docs.module.css';
import { TryInputError, buildTryUrl, formatBody, parseSseChunk, type TryEndpoint } from './format';

export interface PaletteEntry {
  id: string;
  method: 'GET' | 'POST';
  path: string;
  summary: string;
  groupTitle: string;
}

const SSE_EVENTS = 3;
const SSE_TIMEOUT_MS = 20_000;
const REQUEST_TIMEOUT_MS = 30_000;
const PALETTE_MAX = 40;

// ── reading progress ──────────────────────────────────────────────────────────────────────────

function scrollRoot(): HTMLElement | null {
  return document.querySelector<HTMLElement>('[data-scroll-root]');
}

function ReadingProgress() {
  const bar = useRef<HTMLDivElement>(null);
  const fill = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const root = scrollRoot();
    if (!root) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const max = root.scrollHeight - root.clientHeight;
      const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((root.scrollTop / max) * 100))) : 100;
      if (fill.current) fill.current.style.transform = `scaleX(${pct / 100})`;
      bar.current?.setAttribute('aria-valuenow', String(pct));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    update();
    root.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      root.removeEventListener('scroll', onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);
  return (
    <div ref={bar} role="progressbar" aria-label="Reading progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={0} className={s.progress}>
      <div ref={fill} className={s.progressFill} />
    </div>
  );
}

// ── scroll-spy ────────────────────────────────────────────────────────────────────────────────

function useScrollSpy() {
  useEffect(() => {
    const root = scrollRoot();
    const nav = document.querySelector('nav[aria-label="API sections"]');
    if (!root || !nav || typeof IntersectionObserver === 'undefined') return;
    const links = new Map<string, HTMLAnchorElement>();
    for (const a of nav.querySelectorAll<HTMLAnchorElement>('a[href^="#"]')) links.set(a.getAttribute('href')!.slice(1), a);
    const sections = [...links.keys()].map((id) => document.getElementById(id)).filter((el): el is HTMLElement => Boolean(el));
    const visible = new Set<string>();
    let current = '';
    const mark = () => {
      const first = sections.find((el) => visible.has(el.id));
      if (!first || first.id === current) return;
      current = first.id;
      for (const [id, a] of links) {
        if (id === current) a.setAttribute('aria-current', 'location');
        else a.removeAttribute('aria-current');
      }
    };
    // A section counts once its heading reaches the upper 40 % of the scroller.
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          const id = (e.target as HTMLElement).dataset.spyFor;
          if (!id) continue;
          if (e.isIntersecting) visible.add(id);
          else visible.delete(id);
        }
        mark();
      },
      { root, rootMargin: '0px 0px -60% 0px' },
    );
    // Observe each section's whole box so long sections stay current while their middle is on screen.
    const targets = sections.map((heading) => {
      const box = heading.closest('section') ?? heading;
      (box as HTMLElement).dataset.spyFor = heading.id;
      io.observe(box);
      return box as HTMLElement;
    });
    return () => {
      io.disconnect();
      for (const t of targets) delete t.dataset.spyFor;
    };
  }, []);
}

// ── navigation helper ─────────────────────────────────────────────────────────────────────────

function goToEndpoint(id: string) {
  const el = document.getElementById(id);
  if (!el) return;
  el.querySelector('details')?.setAttribute('open', '');
  history.replaceState(null, '', `#${id}`);
  el.scrollIntoView({ block: 'start' });
  el.focus({ preventScroll: true });
}

// ── ⌘K palette ────────────────────────────────────────────────────────────────────────────────

function matches(e: PaletteEntry, terms: string[]): boolean {
  const hay = `${e.method} ${e.path} ${e.summary} ${e.groupTitle}`.toLowerCase();
  return terms.every((t) => hay.includes(t));
}

function Palette({ entries, open, onClose }: { entries: PaletteEntry[]; open: boolean; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const uid = useId();
  const list = useMemo(() => {
    const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
    return (terms.length ? entries.filter((e) => matches(e, terms)) : entries).slice(0, PALETTE_MAX);
  }, [entries, query]);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      input.current?.focus();
    } else if (!open && d.open) {
      d.close();
    }
  }, [open]);

  const close = () => {
    setQuery('');
    setActive(0);
    onClose();
  };

  const choose = (e: PaletteEntry | undefined) => {
    if (!e) return;
    close();
    requestAnimationFrame(() => goToEndpoint(e.id));
  };

  const onKeyDown = (ev: ReactKeyboardEvent<HTMLInputElement>) => {
    if (ev.key === 'ArrowDown') {
      ev.preventDefault();
      setActive((i) => Math.min(list.length - 1, i + 1));
    } else if (ev.key === 'ArrowUp') {
      ev.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (ev.key === 'Enter') {
      ev.preventDefault();
      choose(list[active]);
    }
  };

  const optionId = (i: number) => `${uid}-opt-${i}`;
  return (
    <dialog ref={dialog} aria-labelledby={`${uid}-title`} className={s.dialog} onClose={close}>
      <div className={s.dialogBody}>
        <h2 id={`${uid}-title`} className="hud-title">
          Search endpoints
        </h2>
        <input
          ref={input}
          type="search"
          role="combobox"
          aria-expanded="true"
          aria-controls={`${uid}-list`}
          aria-activedescendant={list.length ? optionId(active) : undefined}
          aria-autocomplete="list"
          aria-label="Endpoint path, summary or group"
          placeholder="flights, bbox, dossier…"
          autoComplete="off"
          spellCheck={false}
          value={query}
          onChange={(ev) => {
            setQuery(ev.target.value);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className={s.input}
        />
        <p className="sr-only" aria-live="polite">
          {list.length} matching endpoints
        </p>
        <ul id={`${uid}-list`} role="listbox" aria-label="Endpoints" className={s.paletteList}>
          {list.map((e, i) => (
            <li
              key={e.id}
              id={optionId(i)}
              role="option"
              aria-selected={i === active}
              className={s.paletteOption}
              onMouseMove={() => setActive(i)}
              onClick={() => choose(e)}
            >
              <span className="font-mono text-[12px] text-fg-heading">
                <span className={e.method === 'GET' ? 'text-cyan' : 'text-gold-light'}>{e.method}</span> {e.path}
              </span>
              <span className="block text-[12px] text-fg-secondary">
                {e.groupTitle} · {e.summary}
              </span>
            </li>
          ))}
          {!list.length && <li className="px-3 py-2 text-[12px] text-fg-secondary">No endpoint matches “{query}”.</li>}
        </ul>
        <div className="mt-3 flex justify-end">
          <button type="button" className={s.button} onClick={close}>
            Close
          </button>
        </div>
      </div>
    </dialog>
  );
}

// ── "Send request" console ────────────────────────────────────────────────────────────────────

type TryResult =
  | { kind: 'error'; message: string }
  | {
      kind: 'response';
      url: string;
      status: number;
      statusText: string;
      ms: number;
      headers: [string, string][];
      body: string;
      truncated: boolean;
      bytes: number | null;
      note: string | null;
    };

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} kB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

async function readSse(res: Response, signal: AbortSignal): Promise<{ body: string; note: string }> {
  const reader = res.body?.getReader();
  if (!reader) return { body: '', note: 'The stream sent no body.' };
  const decoder = new TextDecoder();
  let buffer = '';
  const got: { event: string; data: string }[] = [];
  try {
    while (got.length < SSE_EVENTS && !signal.aborted) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const parsed = parseSseChunk(buffer);
      buffer = parsed.rest;
      got.push(...parsed.events);
    }
  } finally {
    await reader.cancel().catch(() => undefined);
  }
  const shown = got.slice(0, SSE_EVENTS);
  const body = shown.map((e) => `event: ${e.event}\ndata: ${formatBody(e.data, 'application/json', 4000).text}`).join('\n\n');
  const note = signal.aborted
    ? `Stopped after ${shown.length} event(s): no further event within ${SSE_TIMEOUT_MS / 1000} s.`
    : `First ${shown.length} event(s); the console then closed the stream.`;
  return { body, note };
}

function TryConsole({ endpoint, onClose }: { endpoint: TryEndpoint | null; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const uid = useId();
  // Keyed by endpoint id in the parent, so state starts fresh for every endpoint.
  const [values, setValues] = useState<Record<string, string>>(() => ({ ...endpoint?.initial }));
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<TryResult | null>(null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (endpoint) {
      if (!d.open) d.showModal();
    } else if (d.open) {
      d.close();
    }
  }, [endpoint]);

  const stop = useCallback(() => {
    abort.current?.abort();
    abort.current = null;
  }, []);
  useEffect(() => stop, [stop]);

  const close = () => {
    stop();
    onClose();
  };

  let preview = '';
  let previewError: string | null = null;
  if (endpoint) {
    try {
      const u = buildTryUrl(endpoint, values, window.location.origin);
      preview = `${u.pathname}${u.search}`;
    } catch (e) {
      previewError = e instanceof TryInputError ? e.message : 'Invalid input.';
    }
  }

  const send = async (ev: FormEvent) => {
    ev.preventDefault();
    if (!endpoint) return;
    let url: URL;
    try {
      url = buildTryUrl(endpoint, values, window.location.origin);
    } catch (e) {
      setResult({ kind: 'error', message: e instanceof TryInputError ? e.message : 'Invalid input.' });
      return;
    }
    stop();
    const ctl = new AbortController();
    abort.current = ctl;
    const timer = setTimeout(() => ctl.abort(), endpoint.sse ? SSE_TIMEOUT_MS : REQUEST_TIMEOUT_MS);
    setBusy(true);
    setResult(null);
    const t0 = performance.now();
    try {
      const res = await fetch(url, { method: 'GET', credentials: 'same-origin', cache: 'no-store', signal: ctl.signal, headers: { accept: endpoint.sse ? 'text/event-stream' : 'application/json, */*;q=0.5' } });
      const headers = [...res.headers.entries()].sort(([a], [b]) => a.localeCompare(b));
      const type = res.headers.get('content-type');
      let body = '';
      let truncated = false;
      let bytes: number | null = null;
      let note: string | null = null;
      if (type?.includes('text/event-stream')) {
        const out = await readSse(res, ctl.signal);
        body = out.body;
        note = out.note;
      } else if (type && /^(image|video|audio)\//.test(type)) {
        const buf = await res.arrayBuffer();
        bytes = buf.byteLength;
        note = `Binary ${type} response, not displayed here.`;
      } else {
        const text = await res.text();
        bytes = new TextEncoder().encode(text).byteLength;
        const f = formatBody(text, type);
        body = f.text;
        truncated = f.truncated;
      }
      setResult({ kind: 'response', url: `${url.pathname}${url.search}`, status: res.status, statusText: res.statusText, ms: Math.round(performance.now() - t0), headers, body, truncated, bytes, note });
    } catch (e) {
      const aborted = e instanceof DOMException && e.name === 'AbortError';
      setResult({ kind: 'error', message: aborted ? 'Request stopped (timeout or cancelled).' : `Request failed: ${e instanceof Error ? e.message : String(e)}` });
    } finally {
      clearTimeout(timer);
      if (abort.current === ctl) abort.current = null;
      setBusy(false);
    }
  };

  return (
    <dialog ref={dialog} aria-labelledby={`${uid}-title`} className={`${s.dialog} ${s.dialogWide}`} onClose={close}>
      {endpoint && (
        <div className={s.dialogBody}>
          <h2 id={`${uid}-title`} className="flex flex-wrap items-center gap-2">
            <span className="hud-text rounded border border-[var(--border-cyan)] px-1.5 py-0.5 text-[11px] text-cyan">GET</span>
            <code className="font-mono text-[13px] text-fg-heading [overflow-wrap:anywhere]">{endpoint.path}</code>
          </h2>
          <p className="mt-2 text-[12px] text-fg-secondary">
            {endpoint.summary}. Sent from your browser to this server only{endpoint.sse ? '; shows the first three events' : ''}.
          </p>
          <form onSubmit={send} className="mt-4 grid gap-3">
            {endpoint.params.map((p) => {
              const id = `${uid}-${p.name}`;
              const common = {
                id,
                name: p.name,
                value: values[p.name] ?? '',
                required: p.required,
                'aria-describedby': `${id}-hint`,
                className: s.input,
              };
              return (
                <div key={p.name}>
                  <label htmlFor={id} className="font-mono text-[12px] text-fg-heading">
                    {p.name} <span className="text-fg-secondary">({p.in}{p.required ? ', required' : ''})</span>
                  </label>
                  {p.enum?.length ? (
                    <select {...common} onChange={(ev) => setValues((v) => ({ ...v, [p.name]: ev.target.value }))}>
                      {!p.required && <option value="">(not set)</option>}
                      {p.enum.map((o) => (
                        <option key={o} value={o}>
                          {o}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <input
                      {...common}
                      type="text"
                      inputMode={p.type === 'number' ? 'decimal' : undefined}
                      placeholder={p.example ? `e.g. ${p.example}` : undefined}
                      autoComplete="off"
                      spellCheck={false}
                      onChange={(ev) => setValues((v) => ({ ...v, [p.name]: ev.target.value }))}
                    />
                  )}
                  <span id={`${id}-hint`} className="mt-1 block text-[12px] text-fg-secondary">
                    {p.description}
                  </span>
                </div>
              );
            })}
            {!endpoint.params.length && <p className="text-[12px] text-fg-secondary">No parameters.</p>}
            <p className="font-mono text-[12px] text-fg [overflow-wrap:anywhere]" aria-live="polite">
              {previewError ? <span className="text-alert-orange">{previewError}</span> : <>GET {preview}</>}
            </p>
            <div className="flex flex-wrap gap-2">
              <button type="submit" className={`${s.button} ${s.buttonPrimary}`} disabled={busy || Boolean(previewError)}>
                {busy ? 'Sending…' : 'Send request'}
              </button>
              {busy && (
                <button type="button" className={s.button} onClick={stop}>
                  Stop
                </button>
              )}
              <button type="button" className={s.button} onClick={() => dialog.current?.close()}>
                Close
              </button>
            </div>
          </form>
          <div aria-live="polite" className="mt-4">
            {result?.kind === 'error' && <p className="text-[12px] text-alert-orange">{result.message}</p>}
            {result?.kind === 'response' && (
              <div className="grid gap-3">
                <p className="font-mono text-[12px]">
                  <span className={result.status < 400 ? 'text-alert-green' : 'text-alert-orange'}>
                    {result.status} {result.statusText}
                  </span>
                  <span className="text-fg-secondary">
                    {' '}
                    · {result.ms} ms{result.bytes !== null ? ` · ${formatBytes(result.bytes)}` : ''}
                  </span>
                </p>
                <details>
                  <summary className="hud-micro cursor-pointer text-fg-secondary">Response headers ({result.headers.length})</summary>
                  <pre className={s.pre}>{result.headers.map(([k, v]) => `${k}: ${v}`).join('\n')}</pre>
                </details>
                {result.note && <p className="text-[12px] text-fg-secondary">{result.note}</p>}
                {result.body && (
                  <pre className={s.pre} aria-label="Response body">
                    {result.body}
                  </pre>
                )}
                {result.truncated && <p className="text-[12px] text-fg-secondary">Body cut to the first 20 000 characters; open the URL for the full response.</p>}
              </div>
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}

// ── root ──────────────────────────────────────────────────────────────────────────────────────

export function DocsInteractive({ tryable, palette }: { tryable: TryEndpoint[]; palette: PaletteEntry[] }) {
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [tryId, setTryId] = useState<string | null>(null);
  const byId = useMemo(() => new Map(tryable.map((t) => [t.id, t])), [tryable]);
  useScrollSpy();

  useEffect(() => {
    // Buttons rendered by the server component are inert until this island has hydrated.
    document.documentElement.dataset.docsInteractive = 'ready';
    const onClick = (ev: MouseEvent) => {
      const target = ev.target instanceof Element ? ev.target : null;
      const tryBtn = target?.closest<HTMLElement>('[data-try]');
      if (tryBtn?.dataset.try) {
        setTryId(tryBtn.dataset.try);
        return;
      }
      if (target?.closest('[data-palette-open]')) setPaletteOpen(true);
    };
    // Shortcuts come from the shared keyboard map (src/lib/keyboard.ts): ⌘K / Ctrl-K and "/".
    const onKey = (ev: KeyboardEvent) => {
      const el = ev.target instanceof HTMLElement ? ev.target : null;
      const inField = Boolean(el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName)));
      if (matchBinding(ev, inField) === 'open-palette') {
        ev.preventDefault();
        setTryId(null);
        setPaletteOpen(true);
      }
    };
    document.addEventListener('click', onClick);
    document.addEventListener('keydown', onKey);
    return () => {
      delete document.documentElement.dataset.docsInteractive;
      document.removeEventListener('click', onClick);
      document.removeEventListener('keydown', onKey);
    };
  }, []);

  return (
    <>
      <ReadingProgress />
      <Palette entries={palette} open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <TryConsole key={tryId ?? ''} endpoint={tryId ? (byId.get(tryId) ?? null) : null} onClose={() => setTryId(null)} />
    </>
  );
}
