/** GODSEYE mark: a geometric eye over a globe (original artwork, not the Eye of Horus). Owner: design-system-hud. */
export default function GodseyeMark({ size = 36, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" className={className}>
      <circle cx="32" cy="32" r="20" fill="none" stroke="var(--gold-primary)" strokeWidth="2" />
      <ellipse cx="32" cy="32" rx="20" ry="8" fill="none" stroke="var(--gold-primary)" strokeWidth="1.2" opacity="0.55" />
      <path d="M32 12v40" stroke="var(--gold-primary)" strokeWidth="1.2" opacity="0.4" />
      <path d="M10 32c6.5-9.5 13.8-14 22-14s15.5 4.5 22 14c-6.5 9.5-13.8 14-22 14s-15.5-4.5-22-14z" fill="none" stroke="var(--gold-light)" strokeWidth="2" />
      <circle cx="32" cy="32" r="5.5" fill="var(--cyan-primary)" />
      <circle cx="32" cy="32" r="2" fill="var(--bg-void)" />
    </svg>
  );
}
