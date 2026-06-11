'use client';

import { feature } from 'topojson-client';
import type { Topology } from 'topojson-specification';
import { useCallback } from 'react';

import { EChart, echarts } from '@/components/echart';
import { ISO_A2_TO_NUMERIC } from '@/lib/geo-iso';
import type { LinkCountryCount } from '@/lib/types';

const MAP_NAME = 'world-110m';

// Register the self-hosted world topology once per session. world-atlas
// features carry numeric ISO ids; we key regions by that id (stable across
// locales) and join from our alpha-2 codes via ISO_A2_TO_NUMERIC.
let mapReady: Promise<void> | null = null;
function ensureWorldMap(): Promise<void> {
  if (!mapReady) {
    mapReady = fetch('/geo/countries-110m.json')
      .then((res) => res.json())
      .then((topology: Topology) => {
        const collection = feature(topology, topology.objects.countries) as unknown as {
          features: Array<{ id?: string | number; properties?: Record<string, unknown> }>;
        };
        for (const f of collection.features) {
          f.properties = { ...f.properties, name: String(f.id ?? '') };
        }
        echarts.registerMap(MAP_NAME, collection as never);
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

// 국가별 열람 choropleth. Codes the topology doesn't cover (or null country)
// simply don't paint — the bar list next to the map remains the exact record.
export function WorldMapChart({ countries }: WorldMapChartProps) {
  const mappable = countries.filter(
    (item): item is LinkCountryCount & { country: string } =>
      Boolean(item.country && ISO_A2_TO_NUMERIC[item.country])
  );

  const buildOption = useCallback(
    (theme: { primary: string; label: string; muted: string; surface: string }) => {
      const max = Math.max(...mappable.map((item) => item.viewers), 1);
      const byNumeric = new Map(
        mappable.map((item) => [
          ISO_A2_TO_NUMERIC[item.country],
          { a2: item.country, viewers: item.viewers }
        ])
      );
      return {
        tooltip: {
          trigger: 'item',
          confine: true,
          formatter: (params: { name: string }) => {
            const hit = byNumeric.get(params.name);
            if (!hit) return '';
            return `${countryFlag(hit.a2)} ${regionName(hit.a2)} · ${hit.viewers}명`;
          }
        },
        visualMap: {
          min: 0,
          max,
          show: false,
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
            // Antarctica wastes a third of the height; crop to inhabited band.
            center: [10, 16],
            zoom: 1.18,
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
              name: ISO_A2_TO_NUMERIC[item.country],
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
