/** Abstract identity chip: deterministic role glyph, never a simulated activity signal. */
export function Character({ variant, color }: { variant: number; color: string }) {
  return <svg viewBox="0 0 90 90" fill="none" aria-hidden="true" className="world-character">
    <path d="M25 8h40l17 17v40L65 82H25L8 65V25z" stroke={color} strokeWidth="2" />
    <path d="M30 18h30l12 12v30L60 72H30L18 60V30z" fill={color} fillOpacity=".12" />
    <path d="M0 31h9M0 45h9M0 59h9m72-28h9m-9 14h9m-9 14h9M31 0v9M45 0v9M59 0v9m-28 72v9m14-9v9m14-9v9" stroke={color} strokeWidth="2" />
    <circle cx="45" cy="45" r="15" stroke={color} strokeWidth="1.5" />
    <text x="45" y="50" textAnchor="middle" fill={color} fontSize="14" fontFamily="monospace">{String(variant + 1).padStart(2, '0')}</text>
  </svg>;
}
