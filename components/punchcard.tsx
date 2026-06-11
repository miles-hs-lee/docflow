import type { PunchcardCell } from '@/lib/data';

type PunchcardProps = {
  cells: PunchcardCell[];
};

// extract(dow): 0 = Sunday … 6 = Saturday. Render Monday-first.
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_LABELS: Record<number, string> = { 0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' };
const HOUR_TICKS = [0, 6, 12, 18];

// 요일 × 시간 punch card (last 90 days): when does the audience actually
// read. Cell intensity = engagement events in that hour bucket. Pure CSS
// grid; intensity rides var(--primary) so themes/dark mode just work.
export function Punchcard({ cells }: PunchcardProps) {
  if (cells.length === 0) return null;
  const total = cells.reduce((sum, cell) => sum + cell.hits, 0);
  if (total === 0) return null;

  const max = Math.max(...cells.map((cell) => cell.hits), 1);
  const byKey = new Map(cells.map((cell) => [`${cell.dow}:${cell.hour}`, cell.hits]));
  const peak = cells.reduce((best, cell) => (cell.hits > best.hits ? cell : best), cells[0]);

  return (
    <div className="punchcard">
      <div
        className="punchcard-grid"
        role="img"
        aria-label={`요일·시간대별 열람 분포, 최다 ${DOW_LABELS[peak.dow]}요일 ${peak.hour}시`}
      >
        {DOW_ORDER.map((dow) => (
          <div key={dow} className="punchcard-row">
            <span className="punchcard-dow">{DOW_LABELS[dow]}</span>
            {Array.from({ length: 24 }, (_, hour) => {
              const hits = byKey.get(`${dow}:${hour}`) ?? 0;
              const intensity = hits === 0 ? 0 : Math.max(10, Math.round((hits / max) * 85));
              return (
                <span
                  key={hour}
                  className="punchcard-cell"
                  title={`${DOW_LABELS[dow]} ${hour}시 · ${hits}회`}
                  style={
                    intensity > 0
                      ? {
                          // eslint-disable-next-line -- --primary: app brand accent (globals.css), intensity is computed
                          background: `color-mix(in srgb, var(--primary) ${intensity}%, transparent)`
                        }
                      : undefined
                  }
                />
              );
            })}
          </div>
        ))}
        <div className="punchcard-row punchcard-axis">
          <span className="punchcard-dow" />
          {Array.from({ length: 24 }, (_, hour) => (
            <span key={hour} className="punchcard-hour">
              {HOUR_TICKS.includes(hour) ? `${hour}시` : ''}
            </span>
          ))}
        </div>
      </div>
      <p className="muted small">
        최근 90일 · 가장 활발한 시간대: {DOW_LABELS[peak.dow]}요일 {peak.hour}시 ({peak.hits}회)
      </p>
    </div>
  );
}
