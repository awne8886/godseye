/**
 * Where a horizontal tab strip must scroll so its selected tab is fully readable. The strip fades
 * out over its last `fadeEnd` px (.hud-fade-right: 24 px, inside the strip's end padding), so a tab under the fade is
 * not "visible" either. Pure: the caller measures, this decides (r7 m: on a 390 px phone the
 * selected STYLE STUDIO tab sat past the end of the strip). Owner: design-system-hud.
 */
export interface TabRevealInput {
  /** Current scrollLeft of the strip. */
  scrollLeft: number;
  /** clientWidth of the strip. */
  viewWidth: number;
  /** Tab's left edge in the strip's scroll coordinates (rect.left − strip.left + scrollLeft). */
  tabLeft: number;
  tabWidth: number;
  /** Leading inset kept clear (the strip's left padding). */
  padStart?: number;
  /** Width of the right-edge fade in px. */
  fadeEnd?: number;
}

export function tabRevealScroll({ scrollLeft, viewWidth, tabLeft, tabWidth, padStart = 12, fadeEnd = 24 }: TabRevealInput): number {
  if (!(viewWidth > 0)) return scrollLeft;
  const clear = viewWidth - fadeEnd;
  const start = Math.max(0, tabLeft - padStart);
  // Off the left edge, or wider than the clear area: align its start.
  if (tabLeft < scrollLeft + padStart || tabWidth + padStart > clear) return start;
  // Under the fade or past the right edge: bring its end to the end of the clear area.
  if (tabLeft + tabWidth > scrollLeft + clear) return Math.max(0, Math.ceil(tabLeft + tabWidth - clear));
  return scrollLeft;
}

/** Measure `list` and scroll it so its selected tab is readable (no-op before layout). */
export function revealSelectedTab(list: HTMLElement): void {
  const tab = list.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]');
  if (!tab) return;
  const lr = list.getBoundingClientRect();
  const tr = tab.getBoundingClientRect();
  const next = tabRevealScroll({
    scrollLeft: list.scrollLeft,
    viewWidth: list.clientWidth,
    tabLeft: tr.left - lr.left + list.scrollLeft,
    tabWidth: tr.width,
    padStart: parseFloat(getComputedStyle(list).paddingLeft) || 0,
    fadeEnd: parseFloat(getComputedStyle(list).paddingRight) || 0,
  });
  if (next !== list.scrollLeft) list.scrollLeft = next;
}
