/** Simple level meter. `level` is RMS 0..1; displayed on a dB-like scale. */
export default function Meter({ level, vertical = false }: { level: number; vertical?: boolean }) {
  const db = level > 0 ? 20 * Math.log10(level) : -60;
  const pct = Math.max(0, Math.min(100, ((db + 48) / 48) * 100));
  const hot = db > -3;
  return (
    <div className={`meter ${vertical ? 'vertical' : ''}`} role="meter" aria-valuemin={-48} aria-valuemax={0} aria-valuenow={Math.round(db)} aria-label="Level">
      <div className={`meter-fill ${hot ? 'hot' : ''}`} style={vertical ? { height: `${pct}%` } : { width: `${pct}%` }} />
    </div>
  );
}
