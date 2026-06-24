import { desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { campaigns } from '@/db/schema';
import { requireUser, requireRole } from '@/auth/workos';
import { getLeaderboard } from '@/services/ranking';
import { t, sans, mono } from '@/ui/tokens';
import RunRankingButton from './RunRankingButton';
import type { LeaderboardRow } from '@/types/contracts';

function fmt(n: number | null, decimals = 1): string {
  if (n === null) return '—';
  return n.toFixed(decimals);
}

function pct(n: number | null): string {
  if (n === null) return '—';
  return `${(n * 100).toFixed(1)}%`;
}

export default async function LeaderboardPage() {
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

  // Get default campaign (most-recent)
  const [defaultCampaign] = await db
    .select({ id: campaigns.id, name: campaigns.name })
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt))
    .limit(1);

  const rows: LeaderboardRow[] = await getLeaderboard();

  return (
    <div>
      {/* Page header */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: 28,
        }}
      >
        <div>
          <h1
            style={{
              margin: 0,
              fontSize: 22,
              fontWeight: 700,
              color: t.ink,
              fontFamily: sans,
            }}
          >
            Leaderboard
          </h1>
          {defaultCampaign && (
            <p style={{ margin: '4px 0 0', fontSize: 12, color: t.inkFaint, fontFamily: sans }}>
              Campaign: {defaultCampaign.name}
            </p>
          )}
        </div>

        {defaultCampaign ? (
          <RunRankingButton campaignId={defaultCampaign.id} />
        ) : (
          <span style={{ fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
            No campaign found
          </span>
        )}
      </div>

      {/* Table */}
      {rows.length === 0 ? (
        <div
          style={{
            backgroundColor: t.card,
            border: `1px solid ${t.line}`,
            borderRadius: 8,
            padding: 32,
            textAlign: 'center',
            color: t.inkFaint,
            fontFamily: sans,
            fontSize: 14,
          }}
        >
          No ranking data yet. Run a ranking to populate this table.
        </div>
      ) : (
        <div
          style={{
            backgroundColor: t.card,
            border: `1px solid ${t.line}`,
            borderRadius: 8,
            overflow: 'hidden',
          }}
        >
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${t.line}`, backgroundColor: t.lineSoft }}>
                {[
                  'Rank',
                  'Competitor',
                  'Version',
                  'Score',
                  'Rank range',
                  'CI',
                  'Judgments',
                  'Cases',
                  'Tie rate',
                  'Unacceptable',
                ].map((col) => (
                  <th
                    key={col}
                    style={{
                      padding: '10px 14px',
                      textAlign: 'left',
                      fontFamily: sans,
                      fontWeight: 600,
                      fontSize: 11,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase',
                      color: t.inkFaint,
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr
                  key={row.competitor_version_id}
                  style={{
                    borderBottom: i < rows.length - 1 ? `1px solid ${t.lineSoft}` : 'none',
                    backgroundColor: i % 2 === 0 ? t.card : '#FAFAF8',
                  }}
                >
                  <td style={{ padding: '10px 14px', fontFamily: mono, fontWeight: 700, color: t.accent, fontSize: 13 }}>
                    {row.rank ?? '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: sans, fontWeight: 600, color: t.ink, fontSize: 13 }}>
                    {row.competitor_name}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, color: t.inkSoft, fontSize: 12 }}>
                    v{row.version}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, color: t.ink, fontSize: 13 }}>
                    {fmt(row.display_score)}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, color: t.inkSoft, fontSize: 12 }}>
                    {row.rank_lower !== null && row.rank_upper !== null
                      ? `${row.rank_lower}–${row.rank_upper}`
                      : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, color: t.inkSoft, fontSize: 12 }}>
                    {row.confidence_lower !== null && row.confidence_upper !== null
                      ? `${fmt(row.confidence_lower)}–${fmt(row.confidence_upper)}`
                      : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, color: t.inkSoft, fontSize: 12 }}>
                    {row.judgment_count}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, color: t.inkSoft, fontSize: 12 }}>
                    {row.case_count}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, color: t.inkSoft, fontSize: 12 }}>
                    {pct(row.tie_rate)}
                  </td>
                  <td style={{ padding: '10px 14px', fontFamily: mono, color: t.inkSoft, fontSize: 12 }}>
                    {pct(row.unacceptable_rate)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
