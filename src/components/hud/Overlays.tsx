/** Permanent screen overlays: vignette, 2% scanlines, four 64 px gold hairline corner brackets. Owner: design-system-hud. */
export default function Overlays() {
  const corner = 'pointer-events-none absolute h-16 w-16 border-[rgba(212,175,55,0.3)]';
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 z-[2]">
      <div className="vignette absolute inset-0" />
      <div className="crt-scanlines absolute inset-0 opacity-100" />
      <div className={`${corner} left-2 top-2 border-l border-t`} />
      <div className={`${corner} right-2 top-2 border-r border-t`} />
      <div className={`${corner} bottom-9 left-2 border-b border-l`} />
      <div className={`${corner} bottom-9 right-2 border-b border-r`} />
    </div>
  );
}
