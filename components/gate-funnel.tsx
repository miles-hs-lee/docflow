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
// of four empty rows. Width is % of the first stage.
export function GateFunnelChart({ funnel, requireEmail, requireAgreement, allowDownload }: GateFunnelChartProps) {
  if (funnel.visits === 0) return null;

  const stages = [
    { key: 'visits', label: '방문', value: funnel.visits, show: true },
    { key: 'email', label: '이메일 제출', value: funnel.email_submits, show: Boolean(requireEmail) || funnel.email_submits > 0 },
    { key: 'nda', label: 'NDA 서명', value: funnel.agreements, show: Boolean(requireAgreement) || funnel.agreements > 0 },
    { key: 'view', label: '열람', value: funnel.viewers, show: true },
    { key: 'download', label: '다운로드', value: funnel.downloaders, show: Boolean(allowDownload) || funnel.downloaders > 0 }
  ].filter((stage) => stage.show);

  const base = funnel.visits;

  return (
    <div className="gate-funnel">
      {stages.map((stage, index) => {
        const pct = Math.round((stage.value / base) * 100);
        const widthPct = stage.value > 0 ? Math.max(3, pct) : 0;
        // Deepen the tone as the funnel narrows (index-based, not value-based,
        // so the visual order is stable even when a later stage outcounts an
        // earlier optional one).
        const intensity = 35 + Math.round((index / Math.max(stages.length - 1, 1)) * 55);
        return (
          <div key={stage.key} className="gate-funnel-row">
            <span className="gate-funnel-label">{stage.label}</span>
            <span className="gate-funnel-track">
              {widthPct > 0 ? (
                <span
                  className="gate-funnel-fill"
                  style={{
                    width: `${widthPct}%`,
                    // eslint-disable-next-line -- --primary: app brand accent (globals.css), intensity is computed
                    background: `color-mix(in srgb, var(--primary) ${intensity}%, transparent)`
                  }}
                />
              ) : null}
            </span>
            <span className="gate-funnel-value">
              {stage.value}
              <span className="muted small"> · {pct}%</span>
            </span>
          </div>
        );
      })}
    </div>
  );
}
