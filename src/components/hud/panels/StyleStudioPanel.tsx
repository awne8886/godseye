'use client';
/**
 * Style Studio (desktop: non-blocking dialog; phones: the bottom sheet): nine presets (writes `godseye:theme`), Ghost Protocol,
 * accent/signal/text colours, per-class map colours, knobs (panel/border alpha, glow, blur, radius,
 * tracking, motion, scanlines, grain, vignette; AUTO = the preset's own value), a live contrast
 * readout, and sanitised JSON export/import. Presets do not touch map colours: those carry meaning.
 * Owner: design-system-hud.
 */
import { Check, ClipboardPaste, Copy, RotateCcw, TriangleAlert, X } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import type { PanelProps } from '@/lib/feature-module';
import { MAP_TOKENS, type MapToken } from '@/lib/tokens';
import { useUiStore } from '@/lib/store';
import { useStudioStore } from '../hud-store';
import { useIsMobile } from '../hooks';
import ModalShell from '../ModalShell';
import { PanelHeaderTools } from '../PanelChrome';
import {
  GHOST, KNOBS, PRESETS, PRESET_IDS, SIGNAL_DEFAULTS, effectivePalette, exportStudioJson, isPresetId, paletteContrast, parseStudioJson,
  type ColourKey, type KnobKey, type PresetId, type StudioSettings,
} from '../style-engine';

const MAP_SECTIONS: { title: string; keys: MapToken[] }[] = [
  { title: 'AIRCRAFT', keys: ['--map-flight-civil', '--map-flight-private', '--map-flight-gov', '--map-flight-military', '--map-flight-unknown'] },
  { title: 'SATELLITES', keys: ['--map-sat-comms', '--map-sat-military', '--map-sat-navigation', '--map-sat-earth', '--map-sat-science', '--map-sat-other'] },
  { title: 'CAMERAS · NEWS', keys: ['--map-cctv', '--map-news'] },
  { title: 'HAZARDS', keys: ['--map-seismic', '--map-fire', '--map-weather', '--map-volcano', '--map-air-quality'] },
  { title: 'MARITIME · NETWORK', keys: ['--map-port', '--map-ship-cargo', '--map-cable', '--map-malware', '--map-outage', '--map-gps-jam'] },
];

const mapLabel = (k: string) => k.replace('--map-', '').replace(/-/g, ' ').toUpperCase();

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2">
      <h3 className="hud-micro border-b border-[var(--border-secondary)] pb-1 text-[var(--text-muted)]">{title}</h3>
      {children}
    </section>
  );
}

function Swatch({ label, value, onChange, onReset }: { label: string; value: string; onChange: (v: string) => void; onReset?: () => void }) {
  return (
    <div className="flex items-center gap-2">
      {/* The whole row is the colour picker's label, so on phones the row height is the target. */}
      <label className="flex min-h-[28px] flex-1 cursor-pointer items-center gap-2 phone:min-h-[44px]">
        <span className="relative block h-6 w-6 overflow-hidden rounded-[var(--radius-control)] border border-[var(--border-primary)]" style={{ background: value, boxShadow: `0 0 10px ${value}55` }}>
          <input type="color" value={value} onChange={(e) => onChange(e.target.value)} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" aria-label={label} />
        </span>
        <span className="hud-micro flex-1 text-[var(--text-secondary)]">{label}</span>
        <span className="font-mono text-[11px] text-[var(--text-primary)]">{value.toUpperCase()}</span>
      </label>
      {onReset && (
        <button type="button" onClick={onReset} aria-label={`Reset ${label}`} className="hud-control grid h-6 w-6 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:h-11 phone:w-11">
          <RotateCcw size={12} />
        </button>
      )}
    </div>
  );
}

/**
 * One knob: label, range, readout and AUTO. On phones the range input and AUTO are 44 px targets
 * (round 5 visual-qa m2: they were a 4 px tall input and 44×24). The native track stays thin and
 * centred; only the input's hit box grows.
 */
function Knob({ k, value, auto, onChange, onAuto }: { k: KnobKey; value: number; auto: boolean; onChange: (v: number) => void; onAuto: () => void }) {
  const spec = KNOBS[k];
  const readout = auto ? 'AUTO' : k === 'blur' ? `${value}PX` : k === 'tracking' ? `${value.toFixed(3)}EM` : k === 'radius' || k === 'motion' ? `${value.toFixed(2)}×` : `${Math.round((value / spec.max) * 100)}%`;
  return (
    <div className="grid grid-cols-[84px_1fr_64px_auto] items-center gap-2">
      <span className="hud-micro text-[var(--text-secondary)]">{spec.label}</span>
      <input
        type="range"
        min={spec.min}
        max={spec.max}
        step={spec.step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label={spec.label}
        className="h-1 w-full accent-[var(--gold-primary)] phone:h-11"
      />
      <span className="text-right font-mono text-[11px] tabular-nums text-[var(--text-primary)]">{readout}</span>
      <button
        type="button"
        aria-pressed={auto}
        onClick={onAuto}
        className={`hud-micro hud-control min-h-[24px] border px-1.5 phone:min-h-[44px] phone:min-w-[44px] ${auto ? 'border-[var(--border-active)] text-[var(--gold-light)]' : 'border-[var(--border-secondary)] text-[var(--text-secondary)]'}`}
      >
        AUTO
      </button>
    </div>
  );
}

/** The value a knob shows while on AUTO (the preset's own value). */
function autoValue(k: KnobKey, theme: PresetId, ghost: boolean): number {
  const p = ghost ? GHOST : PRESETS[theme];
  switch (k) {
    case 'panelAlpha':
      return 0.88;
    case 'borderAlpha':
      return 0.15;
    case 'glow':
      return p.glow;
    case 'blur':
      return 24;
    case 'radius':
      return 1;
    case 'tracking':
      return 0.08;
    case 'motion':
      return 1;
    case 'scanlines':
      return p.scanlines ?? 0;
    case 'grain':
      return p.grain ?? 0;
    case 'vignette':
      return p.vignette ?? 0;
  }
}

export default function StyleStudioPanel({ onClose }: PanelProps) {
  const embedded = useIsMobile();
  const themeRaw = useUiStore((s) => s.theme);
  const theme: PresetId = isPresetId(themeRaw) ? themeRaw : 'HORUS';
  const setTheme = useUiStore((s) => s.setTheme);
  const ghost = useUiStore((s) => s.ghost);
  const setGhost = useUiStore((s) => s.setGhost);
  const studio = useStudioStore((s) => s.settings);
  const setStudio = useStudioStore((s) => s.set);
  const resetStudio = useStudioStore((s) => s.reset);
  const [msg, setMsg] = useState<{ text: string; tone: 'ok' | 'error' } | null>(null);
  const [importText, setImportText] = useState('');

  const base = ghost ? GHOST : PRESETS[theme];
  const palette = effectivePalette(theme, ghost, studio);
  const contrast = paletteContrast(palette, studio.knobs.panelAlpha ?? 0.88);

  const edit = (patch: Partial<StudioSettings>) => setStudio({ ...studio, ...patch, colours: { ...studio.colours, ...patch.colours }, map: { ...studio.map, ...patch.map }, knobs: { ...studio.knobs, ...patch.knobs } });
  const setColour = (k: ColourKey, v: string) => edit({ colours: { [k]: v } });
  const unsetColour = (k: ColourKey) => {
    const colours = { ...studio.colours };
    delete colours[k];
    setStudio({ ...studio, colours });
  };
  const unsetMap = (k: MapToken) => {
    const map = { ...studio.map };
    delete map[k];
    setStudio({ ...studio, map });
  };
  const toggleAuto = (k: KnobKey) => {
    const knobs = { ...studio.knobs };
    if (k in knobs) delete knobs[k];
    else knobs[k] = autoValue(k, theme, ghost);
    setStudio({ ...studio, knobs });
  };

  const choosePreset = (id: PresetId) => {
    setTheme(id);
    // A preset replaces custom colours (map colours and knobs stay).
    setStudio({ ...studio, colours: {} });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(exportStudioJson(theme, studio));
      setMsg({ text: 'THEME JSON COPIED', tone: 'ok' });
    } catch {
      setMsg({ text: 'CLIPBOARD BLOCKED', tone: 'error' });
    }
  };
  const importJson = (text: string) => {
    try {
      const { theme: t, settings } = parseStudioJson(text);
      if (t) setTheme(t);
      setStudio(settings);
      setMsg({ text: 'THEME IMPORTED (SANITISED)', tone: 'ok' });
      setImportText('');
    } catch (e) {
      setMsg({ text: (e as Error).message.toUpperCase(), tone: 'error' });
    }
  };
  const paste = async () => {
    try {
      importJson(await navigator.clipboard.readText());
    } catch {
      setMsg({ text: 'CLIPBOARD BLOCKED — PASTE BELOW', tone: 'error' });
    }
  };

  const colourValue = (k: ColourKey): string => {
    const c = studio.colours[k];
    if (c) return c;
    if (k in SIGNAL_DEFAULTS) return SIGNAL_DEFAULTS[k as keyof typeof SIGNAL_DEFAULTS];
    return (base as unknown as Record<string, string>)[k] ?? '#000000';
  };

  const tools = (
    <>
      <button type="button" onClick={() => void paste()} aria-label="Import theme JSON from clipboard" title="Paste theme JSON" className="hud-control grid h-8 w-8 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:h-11 phone:w-11">
        <ClipboardPaste size={14} />
      </button>
      <button type="button" onClick={() => void copy()} aria-label="Copy theme JSON" title="Copy theme JSON" className="hud-control grid h-8 w-8 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:h-11 phone:w-11">
        <Copy size={14} />
      </button>
      <button
        type="button"
        onClick={() => {
          resetStudio();
          setMsg({ text: 'CUSTOM EDITS CLEARED', tone: 'ok' });
        }}
        aria-label="Reset custom edits"
        title="Reset custom edits"
        className="hud-control grid h-8 w-8 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:h-11 phone:w-11"
      >
        <RotateCcw size={14} />
      </button>
    </>
  );
  const status = (
    <>
      {msg && (
      <p role="status" className="hud-micro px-4 pt-2" style={{ color: msg.tone === 'ok' ? 'var(--alert-green)' : 'var(--alert-red)' }}>
        {msg.text}
      </p>
      )}
    </>
  );
  const sections = (
    <>
      <Section title="PRESET">
        <div role="radiogroup" aria-label="Theme preset" className="grid grid-cols-3 gap-1">
          {PRESET_IDS.map((id) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={theme === id}
              disabled={ghost}
              onClick={() => choosePreset(id)}
              className={`hud-micro hud-control flex min-h-[32px] phone:min-h-[44px] items-center gap-1.5 border px-2 disabled:opacity-60 ${theme === id ? 'border-[var(--border-active)] bg-[rgba(var(--gold-rgb),0.12)] text-[var(--gold-light)]' : 'border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
            >
              <span aria-hidden className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: PRESETS[id].accent, boxShadow: `0 0 6px ${PRESETS[id].accent}` }} />
              {id}
            </button>
          ))}
        </div>
        <button
          type="button"
          aria-pressed={ghost}
          onClick={() => setGhost(!ghost)}
          className={`hud-micro hud-control flex min-h-[32px] phone:min-h-[44px] w-full items-center justify-center gap-2 border ${ghost ? 'border-[var(--border-active)] text-[var(--gold-light)]' : 'border-[var(--border-secondary)] text-[var(--text-secondary)]'}`}
        >
          GHOST PROTOCOL {ghost ? 'ON' : 'OFF'}
        </button>
        {ghost && <p className="font-sans text-[12px] text-[var(--text-secondary)]">Ghost Protocol is applied last and overrides presets and custom colours; knobs still apply.</p>}
      </Section>

      <Section title="CONTRAST (WCAG AA 4.5:1)">
        <ul className="space-y-0.5" aria-label="Live contrast readout">
          {contrast.map((r) => (
            <li key={r.label} className="flex items-center gap-2">
              {r.pass ? <Check size={12} aria-hidden className="text-[var(--alert-green)]" /> : <TriangleAlert size={12} aria-hidden className="text-[var(--alert-orange)]" />}
              <span className="hud-micro flex-1 text-[var(--text-secondary)]">{r.label}</span>
              <span className="font-mono text-[11px] tabular-nums" style={{ color: r.pass ? 'var(--text-primary)' : 'var(--alert-orange)' }}>
                {r.ratio.toFixed(2)}:1 {r.pass ? 'PASS' : 'FAIL'}
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <Section title="ACCENT">
        <Swatch label="PRIMARY" value={colourValue('accent')} onChange={(v) => setColour('accent', v)} onReset={studio.colours.accent ? () => unsetColour('accent') : undefined} />
        <Swatch label="SECONDARY" value={colourValue('accent2')} onChange={(v) => setColour('accent2', v)} onReset={studio.colours.accent2 ? () => unsetColour('accent2') : undefined} />
      </Section>

      <Section title="SIGNAL">
        {(['alertRed', 'alertOrange', 'alertGreen', 'alertBlue'] as const).map((k) => (
          <Swatch
            key={k}
            label={{ alertRed: 'CRITICAL', alertOrange: 'WARNING', alertGreen: 'NOMINAL', alertBlue: 'INFO' }[k]}
            value={colourValue(k)}
            onChange={(v) => setColour(k, v)}
            onReset={studio.colours[k] ? () => unsetColour(k) : undefined}
          />
        ))}
      </Section>

      <Section title="SURFACE · TEXT">
        <Swatch label="BACKGROUND" value={colourValue('bg')} onChange={(v) => setColour('bg', v)} onReset={studio.colours.bg ? () => unsetColour('bg') : undefined} />
        {(['textPrimary', 'textSecondary', 'textMuted', 'textHeading'] as const).map((k) => (
          <Swatch key={k} label={k.replace('text', 'TEXT ').toUpperCase()} value={colourValue(k)} onChange={(v) => setColour(k, v)} onReset={studio.colours[k] ? () => unsetColour(k) : undefined} />
        ))}
      </Section>

      <Section title="MAP LAYERS">
        <p className="font-sans text-[12px] text-[var(--text-secondary)]">Presets never change these: map colours carry meaning. Changing one recolours that class everywhere.</p>
        {MAP_SECTIONS.map((sec) => (
          <div key={sec.title} className="space-y-1">
            <div className="hud-micro text-[var(--text-muted)]">{sec.title}</div>
            {sec.keys.map((k) => (
              <Swatch key={k} label={mapLabel(k)} value={studio.map[k] ?? MAP_TOKENS[k]} onChange={(v) => edit({ map: { [k]: v } })} onReset={studio.map[k] ? () => unsetMap(k) : undefined} />
            ))}
          </div>
        ))}
      </Section>

      <Section title="GLASS · TYPE · MOTION · FX">
        {(Object.keys(KNOBS) as KnobKey[]).map((k) => (
          <Knob
            key={k}
            k={k}
            value={studio.knobs[k] ?? autoValue(k, theme, ghost)}
            auto={!(k in studio.knobs)}
            onChange={(v) => edit({ knobs: { [k]: v } })}
            onAuto={() => toggleAuto(k)}
          />
        ))}
      </Section>

      <Section title="IMPORT JSON">
        <textarea
          value={importText}
          onChange={(e) => setImportText(e.target.value)}
          rows={3}
          aria-label="Theme JSON to import"
          placeholder='{"theme":"EMBER","colours":{},"map":{},"knobs":{}}'
          className="hud-control w-full border border-[var(--border-primary)] bg-[rgba(0,0,0,0.3)] p-2 font-mono text-[11px] text-[var(--text-primary)] placeholder:text-[var(--text-muted)]"
        />
        <button
          type="button"
          disabled={!importText.trim()}
          onClick={() => importJson(importText)}
          className="hud-micro hud-control min-h-[32px] phone:min-h-[44px] w-full border border-[var(--border-active)] text-[var(--gold-light)] disabled:opacity-60"
        >
          IMPORT
        </button>
      </Section>
      <p className="font-sans text-[12px] text-[var(--text-muted)]">Saved in this browser. AUTO keeps the preset&apos;s own value. Imported JSON is checked: unknown keys are dropped, colours must be hex and numbers are clamped.</p>
    </>
  );

  // Phones: the bottom sheet (PanelHost) supplies the title, close button and scroll area, like
  // every other phone panel, so the studio never floats over the header controls (R3-m2). Its
  // tools join the sheet's one header row, beside the close button (round 4 visual m4).
  if (embedded) {
    return (
      <div className="space-y-4" data-testid="style-studio-sheet">
        <PanelHeaderTools>{tools}</PanelHeaderTools>
        {status}
        {sections}
      </div>
    );
  }

  return (
    <ModalShell
      title="STYLE STUDIO"
      description="Live UI tokens: presets, colours, map colours and effects. Saved in this browser."
      onClose={onClose}
      overlay={false}
      hideTitle
      className="bottom-[150px] left-[58px] max-h-[min(calc(100dvh-230px),760px)] w-[360px] phone:bottom-10 phone:left-3 phone:right-3 phone:top-20 phone:max-h-none phone:w-auto"
    >
      {/* Named region like every docked panel, so "STYLE STUDIO" resolves the same way everywhere (R3-m1). */}
      <section aria-label="STYLE STUDIO" className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center gap-1 px-4 pb-2 pt-3">
          <span className="instrument-accent mr-1" aria-hidden />
          <span className="hud-title flex-1">STYLE STUDIO</span>
          {tools}
          <button type="button" onClick={onClose} aria-label="Close Style Studio" className="hud-control grid h-8 w-8 place-items-center text-[var(--text-secondary)] hover:text-[var(--gold-light)] phone:h-11 phone:w-11">
            <X size={15} />
          </button>
        </div>
        <div className="instrument-rule mx-4" aria-hidden />
        {status}
        <div className="hud-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-3">{sections}</div>
      </section>
    </ModalShell>
  );
}
