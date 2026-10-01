/**
 * CSS `linear()` equivalents of motion springs, for animations that stay in CSS so the first-load
 * bundle carries no motion code (perf m-d). The layer toggle knob uses the contract spring
 * (stiffness 500, damping 30, §7) through `--ease-toggle-spring` / `--dur-toggle-spring` in
 * tokens.css; hud/round5.test.tsx pins those tokens to `springToCss(TOGGLE_SPRING)`, so the CSS
 * cannot drift from the spring it stands for. Pure. Owner: design-system-hud.
 */

export interface Spring {
  stiffness: number;
  damping: number;
  mass?: number;
}

/** The layer toggle knob (contract §7, OSIRIS dossier 06 §13: "Layer toggle knob: spring 500/30"). */
export const TOGGLE_SPRING: Spring = { stiffness: 500, damping: 30, mass: 1 };

/** Position (0 → 1) at `t` seconds of a spring released from rest at 0 toward 1 (closed form). */
export function springAt({ stiffness, damping, mass = 1 }: Spring, t: number): number {
  const w0 = Math.sqrt(stiffness / mass);
  const zeta = damping / (2 * Math.sqrt(stiffness * mass));
  if (zeta < 1) {
    const wd = w0 * Math.sqrt(1 - zeta * zeta);
    return 1 - Math.exp(-zeta * w0 * t) * (Math.cos(wd * t) + ((zeta * w0) / wd) * Math.sin(wd * t));
  }
  if (zeta === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
  const s = w0 * Math.sqrt(zeta * zeta - 1);
  const r1 = -zeta * w0 + s;
  const r2 = -zeta * w0 - s;
  return 1 - (r2 * Math.exp(r1 * t) - r1 * Math.exp(r2 * t)) / (r2 - r1);
}

/** Seconds after which the spring stays within `restDelta` of its target (1 ms resolution, ≤ 5 s). */
export function settleTime(spring: Spring, restDelta = 0.002): number {
  let last = 0;
  for (let ms = 0; ms <= 5000; ms++) if (Math.abs(1 - springAt(spring, ms / 1000)) > restDelta) last = ms;
  return (last + 1) / 1000;
}

const fmt = (v: number) => String(Math.round(v * 1000) / 1000);

/**
 * The spring as a CSS duration (ms, rounded up to 10 ms) and a `linear()` easing sampled at
 * `points` equal steps; the last stop is exactly 1, so the animation ends at rest.
 */
export function springToCss(spring: Spring, points = 30, restDelta = 0.002): { durationMs: number; easing: string } {
  const durationMs = Math.ceil((settleTime(spring, restDelta) * 1000) / 10) * 10;
  const stops: string[] = [];
  for (let i = 0; i <= points; i++) stops.push(i === points ? '1' : fmt(springAt(spring, ((i / points) * durationMs) / 1000)));
  return { durationMs, easing: `linear(${stops.join(', ')})` };
}
