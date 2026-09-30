'use client';
/**
 * Settings: view actions (palette, reset, fullscreen, shortcuts) and sensor modes for touch screens,
 * then preferences (persisted per browser as `godseye:settings`, never sent to the server): units, motion,
 * location consent, preview autoplay and preferred AI provider (only providers the server has
 * enabled, from /api/health). Owner: design-system-hud.
 */
import type { ReactNode } from 'react';
import type { PanelProps } from '@/lib/feature-module';
import type { KeyAction } from '@/lib/keyboard';
import { useUiStore, type SensorMode, type Settings } from '@/lib/store';
import { runKeyAction } from '../actions';
import { useHealth } from '../hooks';
import { Toggle } from '../LayerRows';

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="space-y-1.5 border-b border-[var(--border-secondary)] pb-3">
      <div className="hud-micro text-[var(--text-secondary)]">{label}</div>
      {children}
      {hint && <p className="font-sans text-[12px] text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

function Choice<T extends string>({ label, value, options, onChange }: { label: string; value: T; options: { value: T; text: string }[]; onChange: (v: T) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={value === o.value}
          onClick={() => onChange(o.value)}
          className={`hud-micro hud-control min-h-[44px] border px-2.5 md:min-h-[32px] ${value === o.value ? 'border-[var(--border-active)] bg-[rgba(var(--gold-rgb),0.12)] text-[var(--gold-light)]' : 'border-[var(--border-secondary)] text-[var(--text-secondary)] hover:text-[var(--text-primary)]'}`}
        >
          {o.text}
        </button>
      ))}
    </div>
  );
}

const AI: { value: Settings['aiProvider']; text: string; cap: string | null }[] = [
  { value: 'auto', text: 'AUTO', cap: null },
  { value: 'claude', text: 'CLAUDE', cap: 'anthropic' },
  { value: 'gemini', text: 'GEMINI', cap: 'gemini' },
  { value: 'ollama', text: 'OLLAMA', cap: 'ollama' },
];

const VIEW_ACTIONS: { action: KeyAction; text: string }[] = [
  { action: 'open-palette', text: 'COMMANDS' },
  { action: 'reset-view', text: 'RESET VIEW' },
  { action: 'toggle-fullscreen', text: 'FULLSCREEN' },
  { action: 'open-help', text: 'SHORTCUTS' },
];

const SENSOR_OPTIONS: { value: SensorMode; text: string }[] = [
  { value: 'none', text: 'OFF' },
  { value: 'crt', text: 'CRT' },
  { value: 'nvg', text: 'NVG' },
  { value: 'flir', text: 'FLIR' },
  { value: 'noir', text: 'NOIR' },
];

export default function SettingsPanel(_: PanelProps) {
  const sensor = useUiStore((s) => s.sensor);
  const setSensor = useUiStore((s) => s.setSensor);
  const settings = useUiStore((s) => s.settings);
  const update = useUiStore((s) => s.updateSettings);
  const caps = useHealth().data?.capabilities ?? {};
  const aiOptions = AI.filter((a) => a.cap === null || caps[a.cap]?.enabled || settings.aiProvider === a.value);

  return (
    <div className="space-y-3">
      <Row label="VIEW" hint="The same actions as the keyboard shortcuts, for touch screens.">
        <div className="flex flex-wrap gap-1">
          {VIEW_ACTIONS.map((a) => (
            <button
              key={a.action}
              type="button"
              onClick={() => runKeyAction(a.action)}
              className="hud-micro hud-control min-h-[44px] border border-[var(--border-secondary)] px-2.5 text-[var(--text-secondary)] hover:text-[var(--text-primary)] md:min-h-[32px]"
            >
              {a.text}
            </button>
          ))}
        </div>
      </Row>
      <Row label="SENSOR MODE" hint="Post-processing over the map (keys 1–4, 0 clears).">
        <Choice label="Sensor mode" value={sensor} onChange={(m) => setSensor(m)} options={SENSOR_OPTIONS} />
      </Row>
      <Row label="UNITS" hint="Aviation: altitude in feet, speed in knots, distance in nautical miles.">
        <Choice
          label="Units"
          value={settings.units}
          onChange={(units) => update({ units })}
          options={[
            { value: 'aviation', text: 'AVIATION' },
            { value: 'metric', text: 'METRIC' },
            { value: 'imperial', text: 'IMPERIAL' },
          ]}
        />
      </Row>
      <Row label="MOTION" hint="System follows your operating system's reduce-motion setting.">
        <Choice
          label="Motion"
          value={settings.motion}
          onChange={(motion) => update({ motion })}
          options={[
            { value: 'system', text: 'SYSTEM' },
            { value: 'reduced', text: 'REDUCED' },
            { value: 'full', text: 'FULL' },
          ]}
        />
      </Row>
      <Row label="LOCATION" hint="Only used to centre the map on your region after you ask; your browser prompts first and nothing is sent to the server.">
        <Choice
          label="Location consent"
          value={settings.geoConsent}
          onChange={(geoConsent) => update({ geoConsent })}
          options={[
            { value: 'ask', text: 'ASK ON CLICK' },
            { value: 'granted', text: 'ALLOWED' },
            { value: 'denied', text: 'NEVER' },
          ]}
        />
      </Row>
      <Row label="CAMERA PREVIEWS" hint="Off: camera and live-news previews wait for a click.">
        <button
          type="button"
          aria-pressed={settings.previewAutoplay}
          onClick={() => update({ previewAutoplay: !settings.previewAutoplay })}
          className="hud-micro hud-control flex min-h-[44px] items-center gap-2 text-[var(--text-primary)] md:min-h-[32px]"
        >
          <Toggle on={settings.previewAutoplay} /> AUTOPLAY PREVIEWS
        </button>
      </Row>
      <Row label="AI ANALYST" hint="Only providers this server has configured are listed. Briefings are generated text and are labelled as such.">
        <Choice label="AI provider" value={settings.aiProvider} onChange={(aiProvider) => update({ aiProvider })} options={aiOptions} />
      </Row>
      <p className="font-sans text-[12px] text-[var(--text-muted)]">Saved in this browser only.</p>
    </div>
  );
}
