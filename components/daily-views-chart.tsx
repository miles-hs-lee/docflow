import { EmptyState } from '@polaris/ui';

import type { LinkDailyView } from '@/lib/types';
import { formatDateOnly } from '@/lib/format';

type DailyViewsChartProps = {
  data: LinkDailyView[];
};

// Daily engagement, split into 신규 (first-time view sessions, solid) and
// 재방문 (returning sessions = active minus new, lighter). The split is the
// signal a plain bar hides: returning visits mean the document is being
// re-read — interest deepening — while a tall all-new bar is reach, not
// engagement. The RPC has always returned both; this finally renders both.
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
    <>
      <div className="daily-chart" role="img" aria-label="최근 일별 열람 세션 추세 (신규/재방문)">
        {data.map((d) => {
          const newCount = Math.min(d.new_viewers, d.sessions);
          const returning = Math.max(d.sessions - newCount, 0);
          // Min 3% so a 1-session day on a busy link stays visible; cap the
          // pair at 100% so the stack never overflows its track.
          const newPct = newCount === 0 ? 0 : Math.max(3, Math.round((newCount / max) * 100));
          const returningPct =
            returning === 0 ? 0 : Math.min(Math.max(3, Math.round((returning / max) * 100)), 100 - newPct);
          return (
            <div
              key={d.day}
              className="daily-chart-col"
              title={`${formatDateOnly(d.day)} · ${d.sessions}세션 (신규 ${newCount} · 재방문 ${returning})`}
            >
              <div className="daily-chart-track">
                <div className="daily-chart-stack">
                  {returningPct > 0 ? (
                    <div className="daily-chart-bar returning" style={{ height: `${returningPct}%` }} />
                  ) : null}
                  {newPct > 0 ? <div className="daily-chart-bar" style={{ height: `${newPct}%` }} /> : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
      <div className="daily-chart-legend muted small">
        <span className="daily-chart-legend-item">
          <span className="daily-chart-swatch" aria-hidden /> 신규
        </span>
        <span className="daily-chart-legend-item">
          <span className="daily-chart-swatch returning" aria-hidden /> 재방문
        </span>
      </div>
    </>
  );
}
