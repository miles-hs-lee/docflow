import { EmptyState } from '@polaris/ui';

import type { PerPageStat } from '@/lib/types';

type PageHeatmapProps = {
  stats: PerPageStat[];
  // Total pages of the document (files.page_count). When known, the heatmap
  // renders EVERY page 1..N — skipped pages show as honest zero rows — and
  // the reach line anchors to the true first/last page instead of the
  // first/last *recorded* one.
  pageCount?: number | null;
  emptyTitle?: string;
  emptyDescription?: string;
};

// Render guard: a dense heatmap for a 1,000-page document is unreadable and
// heavy. Past this we fall back to recorded-pages-only rows.
const DENSE_RENDER_MAX_PAGES = 300;

const ZERO_STAT = (page: number): PerPageStat => ({
  page_number: page,
  views: 0,
  viewers: 0,
  total_dwell_ms: 0
});

// Per-page engagement heatmap. The bar length encodes cumulative dwell
// time; the right column shows distinct viewers ("N명"). The reach line on
// top shows drop-off: distinct viewers on the first page vs the last.
export function PageHeatmap({
  stats,
  pageCount,
  emptyTitle = '아직 페이지 단위 신호가 없습니다',
  emptyDescription = '공유 링크를 통해 PDF를 열람하면 페이지별 누적 시간이 여기 표시됩니다.'
}: PageHeatmapProps) {
  if (stats.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  const sorted = [...stats].sort((a, b) => a.page_number - b.page_number);
  const lastRecorded = sorted[sorted.length - 1].page_number;

  // Dense mode when the true page count is known (and sane): page_count can
  // lag behind recorded pages on pre-039 data, so take the max of both.
  const totalPages = Math.max(pageCount ?? 0, lastRecorded);
  const dense = Boolean(pageCount) && totalPages <= DENSE_RENDER_MAX_PAGES;

  let rows: PerPageStat[];
  if (dense) {
    const byPage = new Map(sorted.map((s) => [s.page_number, s]));
    rows = Array.from({ length: totalPages }, (_, i) => byPage.get(i + 1) ?? ZERO_STAT(i + 1));
  } else {
    rows = sorted;
  }

  const maxDwell = Math.max(...rows.map((p) => p.total_dwell_ms), 1);

  const first = rows[0];
  const last = rows[rows.length - 1];
  const reachPct = first.viewers > 0 ? Math.round((last.viewers / first.viewers) * 100) : null;

  return (
    <>
      {reachPct !== null && rows.length > 1 ? (
        <p className="muted small heatmap-reach">
          {dense ? '완독률' : '도달률'}: p.{first.page_number} {first.viewers}명 → p.{last.page_number}{' '}
          {last.viewers}명 ({reachPct}%)
        </p>
      ) : null}
      <div className="page-heatmap">
        {rows.map((p) => {
          const seconds = Math.round(p.total_dwell_ms / 1000);
          const widthPct =
            p.total_dwell_ms === 0 ? 0 : Math.max(2, Math.round((p.total_dwell_ms / maxDwell) * 100));
          return (
            <div key={p.page_number} className="page-heatmap-row">
              <span className="page-heatmap-page">p.{p.page_number}</span>
              <div className="page-heatmap-bar">
                {widthPct > 0 ? (
                  <div className="page-heatmap-bar-fill" style={{ width: `${widthPct}%` }} />
                ) : null}
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
