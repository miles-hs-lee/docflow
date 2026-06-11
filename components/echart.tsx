'use client';

import { BarChart, FunnelChart, HeatmapChart, LineChart, MapChart, PieChart } from 'echarts/charts';
import {
  GeoComponent,
  GridComponent,
  LegendComponent,
  MarkLineComponent,
  MarkPointComponent,
  TooltipComponent,
  VisualMapComponent
} from 'echarts/components';
import * as echarts from 'echarts/core';
import { SVGRenderer } from 'echarts/renderers';
import type { EChartsCoreOption } from 'echarts/core';
import { useEffect, useRef } from 'react';

// Modular ECharts runtime: only the chart types the dashboard uses are
// registered, and the SVG renderer keeps output crisp + themeable. This
// wrapper owns init/resize/dispose; chart components own their option.
echarts.use([
  LineChart,
  BarChart,
  PieChart,
  HeatmapChart,
  FunnelChart,
  MapChart,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  VisualMapComponent,
  GeoComponent,
  MarkLineComponent,
  MarkPointComponent,
  SVGRenderer
]);

export { echarts };

// Resolved Polaris-theme colors for chart options (SVG attrs can't read CSS
// vars). Read once per mount from the computed style cascade — the hex
// literals below are LAST-RESORT fallbacks for environments where the token
// cascade is unavailable; at runtime the Polaris vars always win.
export type ChartTheme = {
  primary: string;
  label: string;
  muted: string;
  surface: string;
  danger: string;
};

export function readChartTheme(el: HTMLElement): ChartTheme {
  const styles = getComputedStyle(el);
  const pick = (name: string, fallback: string) => styles.getPropertyValue(name).trim() || fallback;
  /* eslint-disable -- fallback hexes only; runtime values come from Polaris CSS vars above */
  return {
    primary: pick('--primary', '#534ab7'),
    label: pick('--polaris-label-default', '#26215c'),
    muted: pick('--polaris-label-muted', '#888780'),
    surface: pick('--polaris-background-normal', '#ffffff'),
    danger: pick('--polaris-error', '#d85a30')
  };
  /* eslint-enable */
}

type EChartProps = {
  /** Builds the option AFTER theme colors are resolved on the client. */
  buildOption: (theme: ChartTheme) => EChartsCoreOption;
  height: number;
  ariaLabel: string;
  /** Resolves before init — used by the map chart to register geo data. */
  prepare?: () => Promise<void>;
};

export function EChart({ buildOption, height, ariaLabel, prepare }: EChartProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    let disposed = false;
    let chart: echarts.ECharts | null = null;
    let observer: ResizeObserver | null = null;

    const render = async () => {
      if (prepare) await prepare();
      if (disposed || !containerRef.current) return;
      chart = echarts.init(containerRef.current, undefined, { renderer: 'svg' });
      chart.setOption(buildOption(readChartTheme(containerRef.current)));
      observer = new ResizeObserver(() => chart?.resize());
      observer.observe(containerRef.current);
    };
    void render();

    return () => {
      disposed = true;
      observer?.disconnect();
      chart?.dispose();
    };
  }, [buildOption, prepare]);

  return <div ref={containerRef} role="img" aria-label={ariaLabel} style={{ width: '100%', height }} />;
}
