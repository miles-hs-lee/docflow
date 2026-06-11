'use client';

import { EmptyState } from '@polaris/ui';
import { useCallback } from 'react';

import { EChart, type ChartTheme } from '@/components/echart';
import type { LinkDailyView } from '@/lib/types';
import { formatDateOnly } from '@/lib/format';

type DailyViewsChartProps = {
  data: LinkDailyView[];
};

// Daily engagement, stacked into 신규 (first-time view sessions) and 재방문
// (returning = active minus new). Returning visits are the deepening-interest
// signal a flat bar hides. ECharts stacked bars + hover tooltip.
export function DailyViewsChart({ data }: DailyViewsChartProps) {
  const buildOption = useCallback(
    (theme: ChartTheme) => {
      const days = data.map((d) => formatDateOnly(d.day).slice(5));
      const fresh = data.map((d) => Math.min(d.new_viewers, d.sessions));
      const returning = data.map((d) => Math.max(d.sessions - Math.min(d.new_viewers, d.sessions), 0));
      return {
        grid: { left: 28, right: 8, top: 28, bottom: 22 },
        legend: {
          top: 0,
          left: 0,
          itemWidth: 10,
          itemHeight: 10,
          icon: 'roundRect',
          textStyle: { color: theme.muted, fontSize: 11 }
        },
        tooltip: {
          trigger: 'axis',
          confine: true,
          formatter: (params: Array<{ dataIndex: number }>) => {
            const i = params[0]?.dataIndex ?? 0;
            const d = data[i];
            return `${formatDateOnly(d.day)}<br/>세션 ${d.sessions} (신규 ${fresh[i]} · 재방문 ${returning[i]})`;
          }
        },
        xAxis: {
          type: 'category',
          data: days,
          axisTick: { show: false },
          axisLine: { lineStyle: { color: `${theme.muted}55` } },
          axisLabel: { color: theme.muted, fontSize: 10, interval: Math.ceil(data.length / 10) - 1 }
        },
        yAxis: {
          type: 'value',
          minInterval: 1,
          splitLine: { lineStyle: { color: `${theme.muted}22` } },
          axisLabel: { color: theme.muted, fontSize: 10 }
        },
        series: [
          {
            name: '신규',
            type: 'bar',
            stack: 'sessions',
            data: fresh,
            itemStyle: { color: theme.primary, borderRadius: [0, 0, 0, 0] },
            barMaxWidth: 18
          },
          {
            name: '재방문',
            type: 'bar',
            stack: 'sessions',
            data: returning,
            itemStyle: { color: `${theme.primary}55`, borderRadius: [3, 3, 0, 0] },
            barMaxWidth: 18
          }
        ]
      };
    },
    [data]
  );

  const total = data.reduce((sum, d) => sum + d.sessions, 0);
  if (data.length === 0 || total === 0) {
    return (
      <EmptyState
        title="아직 열람 활동이 없습니다"
        description="이 링크로 문서를 열람하면 일별 활동 추세가 여기 표시됩니다."
      />
    );
  }

  return <EChart buildOption={buildOption} height={200} ariaLabel="최근 일별 열람 세션 추세 (신규/재방문 스택)" />;
}
