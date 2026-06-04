import { EmptyState } from '@polaris/ui';

import type { PerPageStat } from '@/lib/types';

type PageHeatmapProps = {
  stats: PerPageStat[];
  emptyTitle?: string;
  emptyDescription?: string;
};

// Per-page engagement heatmap. The bar length encodes cumulative dwell
// time; the right column shows distinct viewers ("N명") — review finding #2,
// which replaces the old raw page_view row count ("N회") that over-counted
// re-scrolls. The reach line on top is finding #8: distinct viewers on the
// first recorded page vs the last, i.e. how far readers got (drop-off).
export function PageHeatmap({
  stats,
  emptyTitle = '아직 페이지 단위 신호가 없습니다',
  emptyDescription = '공유 링크를 통해 PDF를 열람하면 페이지별 누적 시간이 여기 표시됩니다.'
}: PageHeatmapProps) {
  if (stats.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const sorted = [...stats].sort((a, b) => a.page_number - b.page_number);
  const maxDwell = Math.max(...sorted.map((p) => p.total_dwell_ms), 1);

  const first = sorted[0];
  const last = sorted[sorted.length - 1];
  const reachPct = first.viewers > 0 ? Math.round((last.viewers / first.viewers) * 100) : null;

  return (
    <>
      {reachPct !== null && sorted.length > 1 ? (
        <p className="muted small heatmap-reach">
          도달률: p.{first.page_number} {first.viewers}명 → p.{last.page_number} {last.viewers}명 ({reachPct}%)
        </p>
      ) : null}
      <div className="page-heatmap">
        {sorted.map((p) => {
          const seconds = Math.round(p.total_dwell_ms / 1000);
          const widthPct = Math.max(2, Math.round((p.total_dwell_ms / maxDwell) * 100));
          return (
            <div key={p.page_number} className="page-heatmap-row">
              <span className="page-heatmap-page">p.{p.page_number}</span>
              <div className="page-heatmap-bar">
                <div className="page-heatmap-bar-fill" style={{ width: `${widthPct}%` }} />
              </div>
              <span className="page-heatmap-dwell">
                {seconds}s · {p.viewers}명
              </span>
            </div>
          );
        })}
      </div>
    </>
  );
}
