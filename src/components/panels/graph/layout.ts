/**
 * Deterministic force layout for the Entity Graph (no randomness: initial positions on a golden-
 * angle spiral in insertion order; repulsion + link springs + centring). Pure, unit-tested.
 * Owner: panels-alerts-markets-dossier-graph.
 */
export interface LayoutNode {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  fixed?: boolean;
}

const GOLDEN = Math.PI * (3 - Math.sqrt(5));

export function seedPosition(i: number, spacing = 26): { x: number; y: number } {
  const r = spacing * Math.sqrt(i);
  return { x: r * Math.cos(i * GOLDEN), y: r * Math.sin(i * GOLDEN) };
}

/** One simulation step; returns the total kinetic energy (stop when small). */
export function step(nodes: LayoutNode[], links: readonly { source: string; target: string }[], opts = { repulsion: 1800, spring: 0.04, length: 70, damping: 0.82, gravity: 0.012 }): number {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  for (let i = 0; i < nodes.length; i++) {
    const a = nodes[i]!;
    for (let j = i + 1; j < nodes.length; j++) {
      const b = nodes[j]!;
      let dx = a.x - b.x;
      let dy = a.y - b.y;
      let d2 = dx * dx + dy * dy;
      if (d2 < 0.01) {
        // Coincident nodes: separate along a fixed, index-derived direction.
        dx = Math.cos(i + j);
        dy = Math.sin(i + j);
        d2 = 1;
      }
      const f = opts.repulsion / d2;
      const d = Math.sqrt(d2);
      a.vx += (dx / d) * f;
      a.vy += (dy / d) * f;
      b.vx -= (dx / d) * f;
      b.vy -= (dy / d) * f;
    }
  }
  for (const l of links) {
    const a = nodes[idx.get(l.source) ?? -1];
    const b = nodes[idx.get(l.target) ?? -1];
    if (!a || !b) continue;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const d = Math.sqrt(dx * dx + dy * dy) || 1;
    const f = opts.spring * (d - opts.length);
    a.vx += (dx / d) * f;
    a.vy += (dy / d) * f;
    b.vx -= (dx / d) * f;
    b.vy -= (dy / d) * f;
  }
  let energy = 0;
  for (const n of nodes) {
    n.vx = (n.vx - n.x * opts.gravity) * opts.damping;
    n.vy = (n.vy - n.y * opts.gravity) * opts.damping;
    if (n.fixed) {
      n.vx = 0;
      n.vy = 0;
      continue;
    }
    n.x += Math.max(-30, Math.min(30, n.vx));
    n.y += Math.max(-30, Math.min(30, n.vy));
    energy += n.vx * n.vx + n.vy * n.vy;
  }
  return energy;
}
