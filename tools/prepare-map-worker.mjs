// MapLibre GL 6 ships an ES-module worker that imports a sibling shared module.
// Turbopack hashes `new URL('maplibre-gl-worker.mjs', import.meta.url)` as an asset
// but does not emit the shared sibling, so the map mounts and never requests a tile.
// We self-host both files under public/maplibre/<version>/ and call setWorkerUrl()
// at runtime (see src/lib/map/worker.ts). Runs on predev and prebuild.
import { copyFile, mkdir, readdir, readFile, rm } from 'node:fs/promises';

const root = new URL('../', import.meta.url);
const source = new URL('node_modules/maplibre-gl/', root);
const { version } = JSON.parse(await readFile(new URL('package.json', source), 'utf8'));
const vendor = new URL('public/maplibre/', root);
const target = new URL(`${version}/`, vendor);

await mkdir(target, { recursive: true });
for (const file of ['dist/maplibre-gl-worker.mjs', 'dist/maplibre-gl-shared.mjs', 'LICENSE.txt']) {
  await copyFile(new URL(file, source), new URL(file.split('/').at(-1), target));
}

// Keep only the installed version so a stale copy can never pass locally and 404 in production.
for (const entry of await readdir(vendor, { withFileTypes: true })) {
  if (entry.isDirectory() && entry.name !== version) {
    await rm(new URL(`${entry.name}/`, vendor), { recursive: true, force: true });
    console.log(`prepare-map-worker: pruned stale maplibre ${entry.name}`);
  }
}
console.log(`prepare-map-worker: vendored maplibre-gl ${version} worker + shared module`);
