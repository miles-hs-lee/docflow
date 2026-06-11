'use client';

import { useCallback } from 'react';

import { EChart, echarts } from '@/components/echart';
import { ISO_A2_TO_MAP_NAME } from '@/lib/geo-map-names';
import type { LinkCountryCount } from '@/lib/types';

const MAP_NAME = 'world';

// Register the self-hosted world geometry once per session. This is the
// ECharts-prepared world GeoJSON (clipped at the antimeridian) — the raw
// world-atlas topology smeared Russia/Fiji into horizontal bands under
// ECharts's plain lat/lon projection. Features are keyed by English name;
// our alpha-2 codes join via ISO_A2_TO_MAP_NAME.
let mapReady: Promise<void> | null = null;
function ensureWorldMap(): Promise<void> {
  if (!mapReady) {
    mapReady = fetch('/geo/world.json')
      .then((res) => res.json())
      .then((geojson) => {
        echarts.registerMap(MAP_NAME, geojson as never);
      })
      .catch((error) => {
        mapReady = null;
        throw error;
      });
  }
  return mapReady;
}

function countryFlag(code: string): string {
  return String.fromCodePoint(...[...code].map((ch) => 0x1f1a5 + ch.charCodeAt(0)));
}

const regionName = (code: string): string => {
  try {
    return new Intl.DisplayNames(['ko'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
};

type WorldMapChartProps = {
  countries: LinkCountryCount[];
};

// 국가별 열람 choropleth. Codes the 110m geometry doesn't cover (micro
// territories) simply don't paint — the bar list next to the map remains
// the exact record.
export function WorldMapChart({ countries }: WorldMapChartProps) {
  const mappable = countries.filter(
    (item): item is LinkCountryCount & { country: string } =>
      Boolean(item.country && ISO_A2_TO_MAP_NAME[item.country])
  );

  const buildOption = useCallback(
    (theme: { primary: string; label: string; muted: string; surface: string }) => {
      const max = Math.max(...mappable.map((item) => item.viewers), 1);
      const byMapName = new Map(
        mappable.map((item) => [
          ISO_A2_TO_MAP_NAME[item.country],
          { a2: item.country, viewers: item.viewers }
        ])
      );
      return {
        tooltip: {
          trigger: 'item',
          confine: true,
          formatter: (params: { name: string }) => {
            const hit = byMapName.get(params.name);
            if (!hit) return '';
            return `${countryFlag(hit.a2)} ${regionName(hit.a2)} · ${hit.viewers}명`;
          }
        },
        visualMap: {
          min: 0,
          max,
          show: false,
          calculable: false,
          inRange: {
            // Transparent-ish tint of the brand color up to full primary.
            color: [`${theme.primary}26`, theme.primary]
          }
        },
        series: [
          {
            type: 'map',
            map: MAP_NAME,
            roam: false,
            zoom: 1.05,
            selectedMode: false,
            itemStyle: {
              areaColor: `${theme.muted}1f`,
              borderColor: theme.surface,
              borderWidth: 0.6
            },
            emphasis: {
              label: { show: false },
              itemStyle: { areaColor: theme.primary }
            },
            data: mappable.map((item) => ({
              name: ISO_A2_TO_MAP_NAME[item.country],
              value: item.viewers
            }))
          }
        ]
      };
    },
    [mappable]
  );

  if (mappable.length === 0) return null;

  return (
    <EChart
      buildOption={buildOption}
      prepare={ensureWorldMap}
      height={300}
      ariaLabel={`국가별 열람 지도: ${mappable.map((c) => `${c.country} ${c.viewers}명`).join(', ')}`}
    />
  );
}
