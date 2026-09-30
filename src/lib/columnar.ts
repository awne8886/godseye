/**
 * Columnar encoding for bulk layers (flights, satellites, cameras): `{fields, rows}` where each
 * row is a tuple in `fields` order. ~40–60% smaller than arrays of objects and cheap to turn
 * into deck.gl binary attributes. Owner: lead. Isomorphic.
 */

export type Cell = string | number | boolean | null;

export function toColumnar<T extends object, const F extends readonly (keyof T & string)[]>(
  items: readonly T[],
  fields: F,
): { fields: F; rows: Cell[][] } {
  const rows = items.map((it) =>
    fields.map((f) => {
      const v = (it as Record<string, unknown>)[f];
      return v === undefined ? null : (v as Cell);
    }),
  );
  return { fields, rows };
}

export function fromColumnar<T>(fields: readonly string[], rows: readonly (readonly Cell[])[]): T[] {
  return rows.map((row) => {
    const o: Record<string, Cell> = {};
    for (let i = 0; i < fields.length; i++) o[fields[i]!] = row[i] ?? null;
    return o as T;
  });
}

/** Index lookup so hot loops can read `row[idx.lat]` without building objects. */
export function fieldIndex<const F extends readonly string[]>(fields: F): { [K in F[number]]: number } {
  return Object.fromEntries(fields.map((f, i) => [f, i])) as { [K in F[number]]: number };
}
