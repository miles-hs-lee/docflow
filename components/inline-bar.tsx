type InlineBarProps = {
  value: number;
  max: number;
  /** Text shown to the right of the bar; defaults to the raw value. */
  label?: string;
};

// Tiny horizontal bar for table cells — turns a number column into a
// scannable chart without leaving the table. max <= 0 renders label-only.
export function InlineBar({ value, max, label }: InlineBarProps) {
  const pct = max > 0 ? Math.max(value > 0 ? 4 : 0, Math.round((value / max) * 100)) : 0;
  return (
    <span className="inline-bar">
      <span className="inline-bar-track" aria-hidden>
        {pct > 0 ? <span className="inline-bar-fill" style={{ width: `${pct}%` }} /> : null}
      </span>
      <span className="inline-bar-label">{label ?? value}</span>
    </span>
  );
}
