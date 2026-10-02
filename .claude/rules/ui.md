---
paths:
  - "src/components/**"
  - "src/features/**/*.tsx"
  - "src/app/**/*.tsx"
---
# UI rules (§7)
- Colours come from CSS tokens (`var(--gold-primary)`, `--map-*`); never hard-code hex in components.
- HUD text: JetBrains Mono (`font-mono`/`.hud-text`), uppercase, tracking .08em (≥ 11 px) or .16em
  (≤ 10 px), `tabular-nums`. Prose: Inter 12–13 px. Readable text ≥ 10 px; muted text uses `--text-muted`.
- Panels: `.glass-panel`, 360 px desktop width, instrument chrome (grid, corner brackets, gold accent
  bar, 11 px/.22em title, state chip STANDBY / PLOTTING / LIVE / N RESULTS).
- Every entity card shows source, observed-at time and a freshness badge (`freshnessLabel()`).
  A failed feed shows SOURCE OFFLINE with last-good time. Reference data shows REFERENCE.
- Accessibility: focus-visible gold ring, `role="dialog"` + `aria-modal` + focus trap on modals,
  `aria-pressed`/`aria-expanded` on toggles and rails, `aria-live="polite"` for alert counts, icons via
  lucide only (no emoji), 44 px touch targets on mobile. Axe/Lighthouse accessibility must be 1.0.
- Motion: `motion/react` only, inside `<MotionConfig reducedMotion="user">`; panels slide 20 px + fade
  180–250 ms; ≤ 3 pulse rings, ≤ 2 ambient animations visible. No global `* { transition }`.
- Heavy panels load with `next/dynamic`. Keyboard shortcuts come only from `src/lib/keyboard.ts`.
