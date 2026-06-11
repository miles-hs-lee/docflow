import type { PerPageStat } from '@/lib/types';

type ReachCurveProps = {
  stats: PerPageStat[];
  pageCount?: number | null;
};

const WIDTH = 640;
const HEIGHT = 120;
const PAD_X = 8;
const PAD_TOP = 18;
const PAD_BOTTOM = 22;

// Drop-off curve: distinct viewers per page as a step area. The single most
// actionable reading view — where exactly does the audience stop. Pure
// server-rendered SVG (no deps); colors ride the Polaris theme var so dark
// mode is automatic. Renders nothing below 3 recorded pages (a 2-point
// "curve" misleads more than it informs).
export function ReachCurve({ stats, pageCount }: ReachCurveProps) {
  if (stats.length < 3) return null;

  const sorted = [...stats].sort((a, b) => a.page_number - b.page_number);
  const lastRecorded = sorted[sorted.length - 1].page_number;
  const totalPages = Math.max(pageCount ?? 0, lastRecorded);
  if (totalPages < 3) return null;

  const byPage = new Map(sorted.map((s) => [s.page_number, s.viewers]));
  const viewers = Array.from({ length: totalPages }, (_, i) => byPage.get(i + 1) ?? 0);
  const maxViewers = Math.max(...viewers, 1);

  const innerWidth = WIDTH - PAD_X * 2;
  const innerHeight = HEIGHT - PAD_TOP - PAD_BOTTOM;
  const stepWidth = innerWidth / totalPages;
  const yFor = (value: number) => PAD_TOP + innerHeight * (1 - value / maxViewers);

  // Step path: hold each page's value across its slot, then drop/rise.
  let line = `M ${PAD_X} ${yFor(viewers[0])}`;
  viewers.forEach((value, index) => {
    const x0 = PAD_X + index * stepWidth;
    const x1 = PAD_X + (index + 1) * stepWidth;
    line += ` L ${x0.toFixed(1)} ${yFor(value).toFixed(1)} L ${x1.toFixed(1)} ${yFor(value).toFixed(1)}`;
  });
  const area = `${line} L ${(PAD_X + innerWidth).toFixed(1)} ${PAD_TOP + innerHeight} L ${PAD_X} ${PAD_TOP + innerHeight} Z`;

  // Biggest single-page drop (skip the trivial p.1 entry) — worth annotating
  // only when it's a meaningful share of the audience.
  let dropPage = 0;
  let dropSize = 0;
  for (let i = 1; i < viewers.length; i += 1) {
    const delta = viewers[i - 1] - viewers[i];
    if (delta > dropSize) {
      dropSize = delta;
      dropPage = i + 1;
    }
  }
  const showDrop = dropSize >= Math.max(2, Math.ceil(maxViewers * 0.25));
  const dropX = PAD_X + (dropPage - 1) * stepWidth;

  const first = viewers[0];
  const last = viewers[totalPages - 1];
  const completionPct = first > 0 ? Math.round((last / first) * 100) : null;

  return (
    <div className="reach-curve">
      <svg
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        width="100%"
        role="img"
        aria-label={`페이지별 도달 곡선: p.1 ${first}명에서 p.${totalPages} ${last}명${completionPct !== null ? `, 완독률 ${completionPct}%` : ''}`}
      >
        <path d={area} className="reach-curve-area" />
        <path d={line} className="reach-curve-line" fill="none" />
        {showDrop ? (
          <>
            <line
              x1={dropX}
              y1={PAD_TOP}
              x2={dropX}
              y2={PAD_TOP + innerHeight}
              className="reach-curve-drop"
            />
            <text x={dropX + 4} y={PAD_TOP + 10} className="reach-curve-annotation">
              p.{dropPage}에서 -{dropSize}명
            </text>
          </>
        ) : null}
        <text x={PAD_X} y={12} className="reach-curve-label">
          p.1 · {first}명
        </text>
        <text x={WIDTH - PAD_X} y={12} textAnchor="end" className="reach-curve-label">
          p.{totalPages} · {last}명{completionPct !== null ? ` (${completionPct}%)` : ''}
        </text>
        <text x={PAD_X} y={HEIGHT - 6} className="reach-curve-axis">
          p.1
        </text>
        <text x={WIDTH - PAD_X} y={HEIGHT - 6} textAnchor="end" className="reach-curve-axis">
          p.{totalPages}
        </text>
      </svg>
    </div>
  );
}
