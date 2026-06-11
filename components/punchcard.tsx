'use client';

import { useCallback } from 'react';

import { EChart, type ChartTheme } from '@/components/echart';
import type { PunchcardCell } from '@/lib/data';

type PunchcardProps = {
  cells: PunchcardCell[];
};

// extract(dow): 0 = Sunday … 6 = Saturday. Render Monday-first, top-down.
const DOW_ORDER = [1, 2, 3, 4, 5, 6, 0];
const DOW_LABELS: Record<number, string> = { 0: '일', 1: '월', 2: '화', 3: '수', 4: '목', 5: '금', 6: '토' };

// 요일 × 시간 heatmap (last 90 days): when does the audience actually read.
export function Punchcard({ cells }: PunchcardProps) {
  const buildOption = useCallback(
    (theme: ChartTheme) => {
      const max = Math.max(...cells.map((cell) => cell.hits), 1);
      const rowIndex = new Map(DOW_ORDER.map((dow, index) => [dow, index]));
      const data = cells
        .filter((cell) => rowIndex.has(cell.dow))
        .map((cell) => [cell.hour, rowIndex.get(cell.dow), cell.hits]);
      return {
        grid: { left: 34, right: 8, top: 8, bottom: 22 },
        tooltip: {
          confine: true,
          formatter: (params: { value: [number, number, number] }) => {
            const [hour, row, hits] = params.value;
            return `${DOW_LABELS[DOW_ORDER[row]]}요일 ${hour}시 · ${hits}회`;
          }
        },
        xAxis: {
          type: 'category',
          data: Array.from({ length: 24 }, (_, h) => `${h}시`),
          splitArea: { show: false },
          axisTick: { show: false },
          axisLine: { show: false },
          axisLabel: { color: theme.muted, fontSize: 10, interval: 5 }
        },
        yAxis: {
          type: 'category',
          data: DOW_ORDER.map((dow) => DOW_LABELS[dow]),
          inverse: true,
          axisTick: { show: false },
          axisLine: { show: false },
          axisLabel: { color: theme.muted, fontSize: 11 }
        },
        visualMap: {
          min: 0,
          max,
          show: false,
          inRange: { color: [`${theme.primary}14`, theme.primary] }
        },
        series: [
          {
            type: 'heatmap',
            data,
            itemStyle: { borderColor: theme.surface, borderWidth: 2, borderRadius: 3 },
            emphasis: { itemStyle: { borderColor: theme.primary } }
          }
        ]
      };
    },
    [cells]
  );

  if (cells.length === 0) return null;
  const total = cells.reduce((sum, cell) => sum + cell.hits, 0);
  if (total === 0) return null;
  const peak = cells.reduce((best, cell) => (cell.hits > best.hits ? cell : best), cells[0]);

  return (
    <>
      <EChart
        buildOption={buildOption}
        height={210}
        ariaLabel={`요일·시간대별 열람 분포, 최다 ${DOW_LABELS[peak.dow]}요일 ${peak.hour}시`}
      />
      <p className="muted small">
        최근 90일 · 가장 활발한 시간대: {DOW_LABELS[peak.dow]}요일 {peak.hour}시 ({peak.hits}회)
      </p>
    </>
  );
}
