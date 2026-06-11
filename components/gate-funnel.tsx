'use client';

import { useCallback } from 'react';

import { EChart, type ChartTheme } from '@/components/echart';
import type { GateFunnel } from '@/lib/data';

type GateFunnelChartProps = {
  funnel: GateFunnel;
  /** Show the 이메일 단계 even at 0 (the link requires it). */
  requireEmail?: boolean;
  /** Show the NDA 단계 even at 0 (the link requires it). */
  requireAgreement?: boolean;
  /** Show the 다운로드 단계 even at 0 (downloads are allowed). */
  allowDownload?: boolean;
};

// Access funnel: how many distinct sessions survive each gate on the way to
// reading (and downloading). Stages that are neither configured nor ever hit
// are dropped, so an ungated link shows the short 방문 → 열람 story instead
// of four empty rows.
export function GateFunnelChart({ funnel, requireEmail, requireAgreement, allowDownload }: GateFunnelChartProps) {
  const stages = [
    { key: 'visits', label: '방문', value: funnel.visits, show: true },
    {
      key: 'email',
      label: '이메일 제출',
      value: funnel.email_submits,
      show: Boolean(requireEmail) || funnel.email_submits > 0
    },
    { key: 'nda', label: 'NDA 서명', value: funnel.agreements, show: Boolean(requireAgreement) || funnel.agreements > 0 },
    { key: 'view', label: '열람', value: funnel.viewers, show: true },
    {
      key: 'download',
      label: '다운로드',
      value: funnel.downloaders,
      show: Boolean(allowDownload) || funnel.downloaders > 0
    }
  ].filter((stage) => stage.show);

  const buildOption = useCallback(
    (theme: ChartTheme) => {
      const base = Math.max(funnel.visits, 1);
      return {
        tooltip: {
          trigger: 'item',
          confine: true,
          formatter: (params: { name: string; value: number }) =>
            `${params.name} · ${params.value}명 (${Math.round((params.value / base) * 100)}%)`
        },
        series: [
          {
            type: 'funnel',
            left: 8,
            right: 8,
            top: 6,
            bottom: 6,
            sort: 'none',
            minSize: '4%',
            gap: 3,
            label: {
              show: true,
              position: 'inside',
              formatter: (params: { name: string; value: number }) =>
                `${params.name}  ${params.value} · ${Math.round((params.value / base) * 100)}%`,
              color: theme.surface,
              fontSize: 12
            },
            itemStyle: { borderWidth: 0, borderRadius: 4 },
            data: stages.map((stage, index) => ({
              name: stage.label,
              value: stage.value,
              itemStyle: {
                // Deepen the tone as the funnel narrows (index-based so the
                // visual order is stable even when a later optional stage
                // outcounts an earlier one).
                color: `${theme.primary}${Math.round(((40 + (index / Math.max(stages.length - 1, 1)) * 60) / 100) * 255)
                  .toString(16)
                  .padStart(2, '0')}`
              }
            }))
          }
        ]
      };
    },
    [funnel.visits, stages]
  );

  if (funnel.visits === 0) return null;

  return (
    <EChart
      buildOption={buildOption}
      height={Math.max(150, stages.length * 44)}
      ariaLabel={`접근 퍼널: ${stages.map((s) => `${s.label} ${s.value}명`).join(' → ')}`}
    />
  );
}
