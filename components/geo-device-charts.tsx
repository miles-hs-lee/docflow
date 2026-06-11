import type { LinkCountryCount, LinkVisitor } from '@/lib/types';
import { classifyDevice } from '@/lib/ua';

// 국가 비율 바 리스트 + 디바이스 도넛 — both derived from data the link page
// already loads (country breakdown RPC + visitor UA strings). Server-rendered
// CSS/SVG, theme-aware via var(--primary) color-mix.

const DEVICE_LABELS: Array<{ key: 'desktop' | 'mobile' | 'tablet'; label: string }> = [
  { key: 'desktop', label: '데스크톱' },
  { key: 'mobile', label: '모바일' },
  { key: 'tablet', label: '태블릿' }
];

// Donut ring shares of the primary tone — strongest first.
const DONUT_OPACITY = [1, 0.55, 0.28];

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
  if (classified === 0) return null;

  const segments = DEVICE_LABELS.map((item) => ({
    ...item,
    count: counts[item.key],
    pct: Math.round((counts[item.key] / classified) * 100)
  })).filter((item) => item.count > 0);

  // SVG donut via stroke-dasharray on a r=30 circle (circumference ≈ 188.5).
  const C = 2 * Math.PI * 30;
  let offset = 0;
  const arcs = segments.map((segment, index) => {
    const length = (segment.count / classified) * C;
    const arc = { ...segment, length, offset, opacity: DONUT_OPACITY[index] ?? 0.2 };
    offset += length;
    return arc;
  });
  const top = segments[0];

  return (
    <div className="device-donut">
      <svg
        viewBox="0 0 80 80"
        width="84"
        height="84"
        role="img"
        aria-label={`디바이스 분포: ${segments.map((s) => `${s.label} ${s.pct}%`).join(', ')}`}
      >
        <circle cx="40" cy="40" r="30" fill="none" className="device-donut-track" strokeWidth="13" />
        {arcs.map((arc) => (
          <circle
            key={arc.key}
            cx="40"
            cy="40"
            r="30"
            fill="none"
            className="device-donut-arc"
            strokeWidth="13"
            strokeDasharray={`${arc.length.toFixed(1)} ${(C - arc.length).toFixed(1)}`}
            strokeDashoffset={(-arc.offset).toFixed(1)}
            style={{ opacity: arc.opacity }}
            transform="rotate(-90 40 40)"
          />
        ))}
        <text x="40" y="45" textAnchor="middle" className="device-donut-center">
          {top.pct}%
        </text>
      </svg>
      <div className="device-donut-legend">
        {arcs.map((arc) => (
          <span key={arc.key} className="device-donut-legend-item">
            <span className="device-donut-swatch" style={{ opacity: arc.opacity }} aria-hidden />
            {arc.label} {arc.pct}% ({arc.count}명)
          </span>
        ))}
      </div>
    </div>
  );
}
