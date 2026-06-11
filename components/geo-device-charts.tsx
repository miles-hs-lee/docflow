'use client';

import { useCallback } from 'react';

import { EChart, type ChartTheme } from '@/components/echart';
import type { LinkCountryCount, LinkVisitor } from '@/lib/types';
import { classifyDevice } from '@/lib/ua';

// 국가 비율 바 리스트(정확한 기록) + 디바이스 도넛 — both derived from data
// the link page already loads. The bars stay plain CSS (they ARE the record);
// the donut gets ECharts hover/legend.

const DEVICE_LABELS: Array<{ key: 'desktop' | 'mobile' | 'tablet'; label: string }> = [
  { key: 'desktop', label: '데스크톱' },
  { key: 'mobile', label: '모바일' },
  { key: 'tablet', label: '태블릿' }
];

function countryFlag(code: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return '';
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1a5 + ch.charCodeAt(0)));
}

export function CountryBars({ countries }: { countries: LinkCountryCount[] }) {
  const total = countries.reduce((sum, item) => sum + item.viewers, 0);
  if (total === 0) return null;
  const max = Math.max(...countries.map((item) => item.viewers), 1);

  return (
    <div className="country-bars">
      {countries.map((item) => {
        const code = item.country ?? null;
        const pct = Math.round((item.viewers / total) * 100);
        const widthPct = Math.max(3, Math.round((item.viewers / max) * 100));
        return (
          <div key={code ?? 'unknown'} className="country-bar-row">
            <span className="country-bar-name">
              {code ? `${countryFlag(code)} ${code}` : '알 수 없음'}
            </span>
            <span className="country-bar-track" aria-hidden>
              <span className="country-bar-fill" style={{ width: `${widthPct}%` }} />
            </span>
            <span className="country-bar-value">
              {item.viewers}명 · {pct}%
            </span>
          </div>
        );
      })}
    </div>
  );
}

export function DeviceDonut({ visitors }: { visitors: LinkVisitor[] }) {
  const counts = { desktop: 0, mobile: 0, tablet: 0 };
  let classified = 0;
  for (const visitor of visitors) {
    const device = classifyDevice(visitor.last_user_agent);
    if (device) {
      counts[device] += 1;
      classified += 1;
    }
  }

  const segments = DEVICE_LABELS.map((item) => ({
    label: item.label,
    count: counts[item.key]
  })).filter((item) => item.count > 0);

  const buildOption = useCallback(
    (theme: ChartTheme) => ({
      tooltip: {
        trigger: 'item',
        confine: true,
        formatter: (params: { name: string; value: number; percent: number }) =>
          `${params.name} · ${params.value}명 (${Math.round(params.percent)}%)`
      },
      legend: {
        bottom: 0,
        left: 'center',
        itemWidth: 10,
        itemHeight: 10,
        icon: 'roundRect',
        textStyle: { color: theme.muted, fontSize: 11 }
      },
      series: [
        {
          type: 'pie',
          radius: ['52%', '78%'],
          center: ['50%', '44%'],
          avoidLabelOverlap: true,
          label: { show: false },
          emphasis: { scale: true, scaleSize: 4 },
          itemStyle: { borderColor: theme.surface, borderWidth: 2 },
          color: [theme.primary, `${theme.primary}8c`, `${theme.primary}47`],
          data: segments.map((segment) => ({ name: segment.label, value: segment.count }))
        }
      ]
    }),
    [segments]
  );

  if (classified === 0) return null;

  return (
    <div className="device-donut-chart">
      <EChart
        buildOption={buildOption}
        height={170}
        ariaLabel={`디바이스 분포: ${segments.map((s) => `${s.label} ${s.count}명`).join(', ')}`}
      />
    </div>
  );
}
