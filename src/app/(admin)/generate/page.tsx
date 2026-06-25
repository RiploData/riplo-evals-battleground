import { desc } from 'drizzle-orm';
import { db } from '@/db/client';
import { campaigns, caseVersions, competitorVersions } from '@/db/schema';
import { requireUser, requireRole } from '@/auth/workos';
import { campaignCellState } from '@/services/generate-batch';
import { t, sans, mono } from '@/ui/tokens';
import GenerateButton from './GenerateButton';
import GenerateMissingButton from './GenerateMissingButton';

export default async function GeneratePage() {
  const user = await requireUser();

  try {
    requireRole(user, 'admin');
  } catch {
    return (
      <div style={{ color: '#b91c1c', fontFamily: sans, fontSize: 14 }}>
        Insufficient role — operator or admin required.
      </div>
    );
  }

  // Default campaign
  const [defaultCampaign] = await db
    .select({
      id: campaigns.id,
      name: campaigns.name,
      eligibleCompetitorVersionIds: campaigns.eligibleCompetitorVersionIds,
    })
    .from(campaigns)
    .orderBy(desc(campaigns.createdAt))
    .limit(1);

  // Get all case version IDs and eligible competitor version IDs for this campaign
  const allCaseVersionIds = defaultCampaign
    ? (await db.select({ id: caseVersions.id }).from(caseVersions)).map((r) => r.id)
    : [];

  const eligibleCvIds: string[] = defaultCampaign?.eligibleCompetitorVersionIds ?? [];

  const cellState = defaultCampaign
    ? await campaignCellState(defaultCampaign.id)
    : { total: 0, ready: 0, missing: 0, missingWithFailures: 0 };

  const total = cellState.total;
  // Rows describe the CURRENT state of eligible cells (distinct cells), not the
  // historical attempt log — so re-running generation never inflates these.
  const stateRows: { label: string; count: number; tone: 'good' | 'bad' | 'neutral' }[] = [
    { label: 'ready (precomputed)', count: cellState.ready, tone: 'good' },
    { label: 'missing', count: cellState.missing, tone: cellState.missing > 0 ? 'bad' : 'neutral' },
    { label: 'missing with failures', count: cellState.missingWithFailures, tone: cellState.missingWithFailures > 0 ? 'bad' : 'neutral' },
  ];

  return (
    <div>
      <h1
        style={{
          margin: '0 0 8px',
          fontSize: 22,
          fontWeight: 700,
          color: t.ink,
          fontFamily: sans,
        }}
      >
        Generate responses
      </h1>

      {defaultCampaign ? (
        <p style={{ margin: '0 0 28px', fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
          Campaign: {defaultCampaign.name} — {allCaseVersionIds.length} case versions ×{' '}
          {eligibleCvIds.length} eligible competitors
        </p>
      ) : (
        <p style={{ margin: '0 0 28px', fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
          No campaign found.
        </p>
      )}

      {/* Trigger */}
      <div
        style={{
          backgroundColor: t.card,
          border: `1px solid ${t.line}`,
          borderRadius: 8,
          padding: 24,
          marginBottom: 28,
        }}
      >
        <h2
          style={{
            margin: '0 0 6px',
            fontSize: 15,
            fontWeight: 700,
            color: t.ink,
            fontFamily: sans,
          }}
        >
          Generate missing responses
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: t.inkSoft, fontFamily: sans }}>
          Calls <code style={{ fontFamily: mono, fontSize: 12 }}>ensureResponse</code> for each
          (case × competitor) cell. Cells that already have a cached response are skipped.
        </p>

        {defaultCampaign ? (
          <GenerateButton
            campaignId={defaultCampaign.id}
            caseVersionIds={allCaseVersionIds}
            competitorVersionIds={eligibleCvIds}
          />
        ) : (
          <span style={{ fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
            No campaign available.
          </span>
        )}
      </div>

      {/* Generate missing (eligibility-aware) */}
      <div
        style={{
          backgroundColor: t.card,
          border: `1px solid ${t.line}`,
          borderRadius: 8,
          padding: 24,
          marginBottom: 28,
        }}
      >
        <h2
          style={{
            margin: '0 0 6px',
            fontSize: 15,
            fontWeight: 700,
            color: t.ink,
            fontFamily: sans,
          }}
        >
          Generate missing (eligibility-aware)
        </h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: t.inkSoft, fontFamily: sans }}>
          Resolves eligible cases × enabled competitors from campaign config. Only generates truly
          missing cells — already-cached cells are skipped. Returns generated / skipped / failed
          counts.
        </p>
        {defaultCampaign ? (
          <GenerateMissingButton campaignId={defaultCampaign.id} />
        ) : (
          <span style={{ fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
            No campaign available.
          </span>
        )}
      </div>

      {/* Status */}
      <div
        style={{
          backgroundColor: t.card,
          border: `1px solid ${t.line}`,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        <div
          style={{
            padding: '12px 18px',
            borderBottom: `1px solid ${t.line}`,
            backgroundColor: t.lineSoft,
            fontSize: 11,
            fontWeight: 700,
            letterSpacing: '0.07em',
            textTransform: 'uppercase' as const,
            color: t.inkFaint,
            fontFamily: sans,
          }}
        >
          Cell coverage
        </div>

        {total === 0 ? (
          <div style={{ padding: 20, fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
            No eligible cells for this campaign yet.
          </div>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${t.line}`, backgroundColor: t.lineSoft }}>
                {['Cell state', 'Count', '% of total'].map((col) => (
                  <th
                    key={col}
                    style={{
                      padding: '9px 14px',
                      textAlign: 'left' as const,
                      fontSize: 11,
                      fontWeight: 600,
                      letterSpacing: '0.06em',
                      textTransform: 'uppercase' as const,
                      color: t.inkFaint,
                      fontFamily: sans,
                    }}
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {stateRows.map((row, i) => (
                <tr
                  key={row.label}
                  style={{
                    borderBottom: i < stateRows.length - 1 ? `1px solid ${t.lineSoft}` : 'none',
                  }}
                >
                  <td
                    style={{
                      padding: '9px 14px',
                      fontFamily: mono,
                      fontSize: 12,
                      color: row.tone === 'good' ? t.accent : row.tone === 'bad' ? '#b91c1c' : t.inkSoft,
                      fontWeight: row.tone === 'neutral' ? 400 : 600,
                    }}
                  >
                    {row.label}
                  </td>
                  <td
                    style={{
                      padding: '9px 14px',
                      fontFamily: mono,
                      fontSize: 12,
                      color: t.ink,
                      fontWeight: 600,
                    }}
                  >
                    {row.count}
                  </td>
                  <td
                    style={{ padding: '9px 14px', fontFamily: mono, fontSize: 12, color: t.inkSoft }}
                  >
                    {total > 0 ? `${((row.count / total) * 100).toFixed(1)}%` : '—'}
                  </td>
                </tr>
              ))}
              <tr style={{ backgroundColor: t.lineSoft }}>
                <td
                  style={{
                    padding: '9px 14px',
                    fontFamily: sans,
                    fontSize: 12,
                    fontWeight: 700,
                    color: t.ink,
                  }}
                >
                  Total eligible cells
                </td>
                <td
                  style={{
                    padding: '9px 14px',
                    fontFamily: mono,
                    fontSize: 12,
                    fontWeight: 700,
                    color: t.ink,
                  }}
                >
                  {total}
                </td>
                <td style={{ padding: '9px 14px' }} />
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
