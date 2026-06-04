import { EmptyState } from '@polaris/ui';

import type { LinkDailyView } from '@/lib/types';
import { formatDateOnly } from '@/lib/format';

type DailyViewsChartProps = {
  data: LinkDailyView[];
};

// Review finding #7 — daily engagement time-series. One bar per day; height
// encodes distinct active sessions (view/page_view). The series itself is
// always dense (the RPC emits a row per day incl. zeros), so an empty chart
// only happens when there's been no activity at all.
export function DailyViewsChart({ data }: DailyViewsChartProps) {
  const total = data.reduce((sum, d) => sum + d.sessions, 0);
  if (data.length === 0 || total === 0) {
    return (
      <EmptyState
        title="아직 열람 활동이 없습니다"
        description="이 링크로 문서를 열람하면 일별 활동 추세가 여기 표시됩니다."
      />
    );
  }

  const max = Math.max(...data.map((d) => d.sessions), 1);

  return (
    <div className="daily-chart" role="img" aria-label="최근 일별 열람 세션 추세">
      {data.map((d) => {
        const heightPct = d.sessions === 0 ? 0 : Math.max(6, Math.round((d.sessions / max) * 100));
        return (
          <div
            key={d.day}
            className="daily-chart-col"
            title={`${formatDateOnly(d.day)} · ${d.sessions}세션 · 신규 ${d.new_viewers}`}
          >
            <div className="daily-chart-track">
              <div className="daily-chart-bar" style={{ height: `${heightPct}%` }} />
            </div>
          </div>
        );
      })}
    </div>
  );
}
