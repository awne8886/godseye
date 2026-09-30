/** Shown when WebGL2 is unavailable (MapLibre 6 requires it). Owner: map-engine. */
export default function WebGLFallback({ reason }: { reason: 'webgl' | 'style' }) {
  return (
    <div role="alert" className="absolute inset-0 grid place-items-center bg-[var(--bg-void)] p-6 text-center">
      <div className="glass-panel max-w-md p-6">
        <p className="hud-title text-[var(--alert-orange)]">{reason === 'webgl' ? 'WEBGL2 REQUIRED' : 'BASEMAP UNAVAILABLE'}</p>
        <p className="mt-3 font-sans text-[13px] leading-relaxed text-[var(--text-secondary)]">
          {reason === 'webgl'
            ? 'GODSEYE renders the globe with WebGL2. Enable hardware acceleration in your browser settings or try a current version of Chrome, Edge, Firefox or Safari.'
            : 'The basemap style could not be loaded from OpenFreeMap. Data panels still work; the map will retry automatically.'}
        </p>
      </div>
    </div>
  );
}
