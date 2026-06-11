'use client';

import { useCallback } from 'react';

import { EChart, type ChartTheme } from '@/components/echart';
import type { PerPageStat } from '@/lib/types';

type ReachCurveProps = {
  stats: PerPageStat[];
  pageCount?: number | null;
};

// Drop-off curve: distinct viewers per page as a step line+area — where
// exactly does the audience stop. The biggest single-page drop gets a mark
// when it sheds a meaningful share of readers. Renders nothing below 3
// recorded pages (a 2-point "curve" misleads more than it informs).
export function ReachCurve({ stats, pageCount }: ReachCurveProps) {
  const sorted = [...stats].sort((a, b) => a.page_number - b.page_number);
  const lastRecorded = sorted.length > 0 ? sorted[sorted.length - 1].page_number : 0;
  const totalPages = Math.max(pageCount ?? 0, lastRecorded);

  const byPage = new Map(sorted.map((s) => [s.page_number, s.viewers]));
  const viewers = Array.from({ length: totalPages }, (_, i) => byPage.get(i + 1) ?? 0);

  const buildOption = useCallback(
    (theme: ChartTheme) => {
      const first = viewers[0] ?? 0;
      const last = viewers[viewers.length - 1] ?? 0;
      const completionPct = first > 0 ? Math.round((last / first) * 100) : null;
      const maxViewers = Math.max(...viewers, 1);

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

      return {
        grid: { left: 28, right: 16, top: 30, bottom: 22 },
        tooltip: {
          trigger: 'axis',
          confine: true,
          formatter: (params: Array<{ dataIndex: number; value: number }>) => {
            const p = params[0];
            return `p.${p.dataIndex + 1} · ${p.value}명`;
          }
        },
        xAxis: {
          type: 'category',
          data: viewers.map((_, i) => `p.${i + 1}`),
          axisTick: { show: false },
          axisLine: { lineStyle: { color: `${theme.muted}55` } },
          axisLabel: { color: theme.muted, fontSize: 10, interval: Math.ceil(viewers.length / 12) - 1 }
        },
        yAxis: {
          type: 'value',
          minInterval: 1,
          name: completionPct !== null ? `완독률 ${completionPct}%` : undefined,
          nameTextStyle: { color: theme.muted, fontSize: 11, align: 'left' },
          splitLine: { lineStyle: { color: `${theme.muted}22` } },
          axisLabel: { color: theme.muted, fontSize: 10 }
        },
        series: [
          {
            type: 'line',
            step: 'end',
            data: viewers,
            symbol: 'circle',
            symbolSize: 5,
            showSymbol: false,
            lineStyle: { color: theme.primary, width: 2 },
            itemStyle: { color: theme.primary },
            areaStyle: { color: `${theme.primary}26` },
            ...(showDrop
              ? {
                  markPoint: {
                    symbol: 'pin',
                    symbolSize: 38,
                    itemStyle: { color: theme.danger },
                    label: { fontSize: 10, color: theme.surface, formatter: `-${dropSize}` },
                    data: [{ coord: [dropPage - 1, viewers[dropPage - 1]], name: 'drop' }]
                  }
                }
              : {})
          }
        ]
      };
    },
    [viewers]
  );

  if (sorted.length < 3 || totalPages < 3) return null;

  return (
    <EChart
      buildOption={buildOption}
      height={180}
      ariaLabel={`페이지별 도달 곡선: p.1 ${viewers[0]}명에서 p.${totalPages} ${viewers[totalPages - 1]}명`}
    />
  );
}
