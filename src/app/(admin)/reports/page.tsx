import { desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { campaigns, rankingRuns } from '@/db/schema';
import { requireUser, requireRole } from '@/auth/workos';
import { headToHead, segments, positionBias } from '@/services/reports';
import { t, sans, mono } from '@/ui/tokens';

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function shortId(id: string): string {
  return id.slice(0, 8);
}

export default async function ReportsPage() {
  const user = await requireUser();

  try {
    requireRole(user, 'admin');
  } catch {
    return (
      <div style={{ color: '#b91c1c', fontFamily: sans, fontSize: 14 }}>
        Insufficient role — analyst, operator, or admin required.
      </div>
    );
  }

  // Fetch default campaign and latest ranking run
  const [defaultCampaign] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt))
    .limit(1);

  const [latestRun] = await db
    .select({ id: rankingRuns.id })
    .from(rankingRuns)
    .orderBy(desc(rankingRuns.createdAt))
    .limit(1);

  const rankingRunId = latestRun?.id;
  const campaignId = defaultCampaign?.id;

  const [h2h, segs, bias] = await Promise.all([
    headToHead(rankingRunId),
    rankingRunId ? segments(rankingRunId, 'kind') : Promise.resolve([]),
    campaignId ? positionBias(campaignId) : Promise.resolve([]),
  ]);

  const sectionStyle: React.CSSProperties = {
    backgroundColor: t.card,
    border: `1px solid ${t.line}`,
    borderRadius: 8,
    overflow: 'hidden',
    marginBottom: 32,
  };

  const sectionHeader: React.CSSProperties = {
    padding: '14px 18px',
    borderBottom: `1px solid ${t.line}`,
    backgroundColor: t.lineSoft,
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.07em',
    textTransform: 'uppercase' as const,
    color: t.inkFaint,
    fontFamily: sans,
  };

  const th: React.CSSProperties = {
    padding: '9px 14px',
    textAlign: 'left' as const,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
    color: t.inkFaint,
    fontFamily: sans,
    whiteSpace: 'nowrap' as const,
    borderBottom: `1px solid ${t.line}`,
    backgroundColor: t.lineSoft,
  };

  const td: React.CSSProperties = {
    padding: '9px 14px',
    fontFamily: mono,
    fontSize: 12,
    color: t.inkSoft,
  };

  return (
    <div>
      <h1
        style={{
          margin: '0 0 28px',
          fontSize: 22,
          fontWeight: 700,
          color: t.ink,
          fontFamily: sans,
        }}
      >
        Reports
      </h1>

      {!campaignId && !rankingRunId && (
        <div
          style={{
            padding: 20,
            backgroundColor: t.rewriteSoft,
            borderRadius: 8,
            fontSize: 13,
            color: t.rewrite,
            fontFamily: sans,
            marginBottom: 24,
          }}
        >
          No campaigns or ranking runs found. Create a campaign and run a ranking first.
        </div>
      )}

      {/* ── Head-to-head matrix ── */}
      <section style={sectionStyle}>
        <div style={sectionHeader}>Head-to-head matrix</div>
        {h2h.competitors.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
            No judgment data available.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr>
                  <th style={{ ...th, minWidth: 100 }}>vs.</th>
                  {h2h.competitors.map((cv) => (
                    <th key={cv} style={{ ...th, minWidth: 80, textAlign: 'center' as const }}>
                      {shortId(cv)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {h2h.competitors.map((cvRow, i) => (
                  <tr key={cvRow} style={{ borderBottom: `1px solid ${t.lineSoft}` }}>
                    <td
                      style={{
                        ...td,
                        fontWeight: 600,
                        color: t.ink,
                        backgroundColor: t.lineSoft,
                      }}
                    >
                      {shortId(cvRow)}
                    </td>
                    {h2h.matrix[i].map((val, j) => (
                      <td
                        key={j}
                        style={{
                          ...td,
                          textAlign: 'center' as const,
                          color: i === j ? t.inkFaint : val > 0 ? t.accent : t.inkSoft,
                          fontWeight: val > 0 && i !== j ? 600 : 400,
                        }}
                      >
                        {i === j ? '—' : val.toFixed(1)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ── Segments by kind ── */}
      <section style={sectionStyle}>
        <div style={sectionHeader}>Segments by kind</div>
        {segs.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
            No segment data available.
          </div>
        ) : (
          <div>
            {segs.map((seg) => (
              <div key={seg.segment} style={{ borderBottom: `1px solid ${t.lineSoft}` }}>
                <div
                  style={{
                    padding: '10px 18px',
                    fontSize: 12,
                    fontWeight: 700,
                    color: t.accent,
                    fontFamily: sans,
                    backgroundColor: t.accentSoft,
                    letterSpacing: '0.04em',
                  }}
                >
                  {seg.segment}
                </div>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                  <thead>
                    <tr>
                      {['Rank', 'Competitor', 'Version', 'Judgments', 'Cases', 'Tie rate', 'Unacceptable'].map(
                        (col) => (
                          <th key={col} style={th}>
                            {col}
                          </th>
                        ),
                      )}
                    </tr>
                  </thead>
                  <tbody>
                    {seg.rows.map((row, i) => (
                      <tr
                        key={row.competitor_version_id}
                        style={{
                          borderBottom:
                            i < seg.rows.length - 1 ? `1px solid ${t.lineSoft}` : 'none',
                        }}
                      >
                        <td style={{ ...td, fontWeight: 700, color: t.accent }}>{row.rank}</td>
                        <td style={{ ...td, fontWeight: 600, color: t.ink, fontFamily: sans }}>
                          {row.competitor_name}
                        </td>
                        <td style={td}>v{row.version}</td>
                        <td style={td}>{row.judgment_count}</td>
                        <td style={td}>{row.case_count}</td>
                        <td style={td}>{row.tie_rate !== null ? pct(row.tie_rate) : '—'}</td>
                        <td style={td}>
                          {row.unacceptable_rate !== null ? pct(row.unacceptable_rate) : '—'}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Position bias ── */}
      <section style={sectionStyle}>
        <div style={sectionHeader}>Position bias</div>
        {bias.length === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
            No position-bias data available.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr>
                {['Competitor version', 'Top (left) win rate', 'Bottom (right) win rate', 'Bias delta', 'N'].map(
                  (col) => (
                    <th key={col} style={th}>
                      {col}
                    </th>
                  ),
                )}
              </tr>
            </thead>
            <tbody>
              {bias.map((row, i) => {
                const delta = row.topWinRate - row.bottomWinRate;
                return (
                  <tr
                    key={row.competitorVersionId}
                    style={{
                      borderBottom: i < bias.length - 1 ? `1px solid ${t.lineSoft}` : 'none',
                    }}
                  >
                    <td style={{ ...td, fontFamily: mono }}>{shortId(row.competitorVersionId)}</td>
                    <td style={td}>{pct(row.topWinRate)}</td>
                    <td style={td}>{pct(row.bottomWinRate)}</td>
                    <td
                      style={{
                        ...td,
                        fontWeight: Math.abs(delta) > 0.05 ? 700 : 400,
                        color:
                          Math.abs(delta) > 0.05
                            ? delta > 0
                              ? t.accent
                              : t.rewrite
                            : t.inkSoft,
                      }}
                    >
                      {delta > 0 ? '+' : ''}
                      {pct(delta)}
                    </td>
                    <td style={td}>{row.n}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
