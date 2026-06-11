import type { LinkDailyView } from '@/lib/types';
import { formatDateOnly } from '@/lib/format';

type SparklineProps = {
  data: LinkDailyView[];
};

const WIDTH = 640;
const HEIGHT = 56;
const PAD = 4;

// 14-day workspace activity strip under the overview tiles — answers "is
// this week busier than last" without opening a single link. Hidden when
// the window has no activity at all (totals already say zero).
export function Sparkline({ data }: SparklineProps) {
  const total = data.reduce((sum, d) => sum + d.sessions, 0);
  if (data.length < 2 || total === 0) return null;

  const max = Math.max(...data.map((d) => d.sessions), 1);
  const innerWidth = WIDTH - PAD * 2;
  const innerHeight = HEIGHT - PAD * 2;
  const stepX = innerWidth / (data.length - 1);
  const points = data.map((d, i) => ({
    x: PAD + i * stepX,
    y: PAD + innerHeight * (1 - d.sessions / max)
  }));

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const area = `${line} L ${(PAD + innerWidth).toFixed(1)} ${HEIGHT - PAD} L ${PAD} ${HEIGHT - PAD} Z`;
  const lastIndex = data.length - 1;
  const peak = data.reduce((best, d, i) => (d.sessions > data[best].sessions ? i : best), 0);

  return (
    <div className="overview-sparkline">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`최근 ${data.length}일 활동 추세, 최고 ${formatDateOnly(data[peak].day)} ${data[peak].sessions}세션`}
      >
        <path d={area} className="sparkline-area" />
        <path d={line} className="sparkline-line" fill="none" />
        <circle cx={points[lastIndex].x} cy={points[lastIndex].y} r="3" className="sparkline-dot" />
      </svg>
      <p className="muted small">
        최근 {data.length}일 활동 세션 — 오늘 {data[lastIndex].sessions} · 최고{' '}
        {formatDateOnly(data[peak].day)} {data[peak].sessions}
      </p>
    </div>
  );
}
