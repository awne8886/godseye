/**
 * The Lighthouse copy that Lighthouse CI runs (owner: pages-docs-privacy-ops).
 *
 * Resolved from @lhci/cli exactly as its node runner resolves the CLI it spawns
 * (`require.resolve('lighthouse')` in @lhci/cli/src/collect/node-runner.js), so the plug-ins in this
 * directory extend the very Gatherer and Audit classes, spread the very desktop config and use the
 * very NetworkRecords computed artifact of the Lighthouse process that measures `/`. No second
 * Lighthouse install is needed or used.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const fromRoot = createRequire(import.meta.url);
const fromLhci = createRequire(fromRoot.resolve('@lhci/cli/package.json'));

/** Absolute path of Lighthouse's ESM entry (core/index.js) as @lhci/cli resolves it. */
export const LIGHTHOUSE_ENTRY = fromLhci.resolve('lighthouse');

const lighthouse = await import(pathToFileURL(LIGHTHOUSE_ENTRY).href);
// The network records Lighthouse's own network-requests audit lists (core/computed/network-records.js).
const networkRecords = await import(pathToFileURL(path.join(path.dirname(LIGHTHOUSE_ENTRY), 'computed', 'network-records.js')).href);

export const { Audit, Gatherer, desktopConfig } = lighthouse;
export const { NetworkRecords } = networkRecords;
