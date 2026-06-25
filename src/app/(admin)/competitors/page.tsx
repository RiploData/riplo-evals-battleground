import { requireUser, requireRole } from '@/auth/workos';
import { listCompetitorsWithStatus } from '@/services/admin';
import { t, sans, mono } from '@/ui/tokens';
import CompetitorToggle from './CompetitorToggle';

export default async function CompetitorsPage() {
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

  const competitors = await listCompetitorsWithStatus();

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 28 }}>
        <h1
          style={{
            margin: 0,
            fontSize: 22,
            fontWeight: 700,
            color: t.ink,
            fontFamily: sans,
          }}
        >
          Competitors
        </h1>
        <span style={{ fontSize: 13, color: t.inkFaint, fontFamily: sans }}>
          {competitors.length} competitors
        </span>
      </div>

      <div
        style={{
          backgroundColor: t.card,
          border: `1px solid ${t.line}`,
          borderRadius: 8,
          overflow: 'hidden',
        }}
      >
        {competitors.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: t.inkFaint, fontFamily: sans, fontSize: 14 }}>
            No competitors found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.line}`, backgroundColor: t.lineSoft }}>
                  {['Name', 'Versions', 'Latest model', 'Enabled'].map((col) => (
                    <th
                      key={col}
                      style={{
                        padding: '10px 14px',
                        textAlign: 'left' as const,
                        fontSize: 11,
                        fontWeight: 600,
                        letterSpacing: '0.06em',
                        textTransform: 'uppercase' as const,
                        color: t.inkFaint,
                        fontFamily: sans,
                        whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {competitors.map((comp, i) => (
                  <tr
                    key={comp.competitorId}
                    style={{
                      borderBottom: i < competitors.length - 1 ? `1px solid ${t.lineSoft}` : 'none',
                      backgroundColor: i % 2 === 0 ? t.card : '#FAFAF8',
                    }}
                  >
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: sans,
                        fontSize: 13,
                        fontWeight: 600,
                        color: t.ink,
                      }}
                    >
                      {comp.name}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: mono,
                        fontSize: 12,
                        color: t.accent,
                        fontWeight: 600,
                      }}
                    >
                      {comp.versionCount}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: mono,
                        fontSize: 12,
                        color: t.inkSoft,
                      }}
                    >
                      {comp.latestModelIdentifier ?? (
                        <span style={{ color: t.inkFaint }}>—</span>
                      )}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <CompetitorToggle
                        competitorId={comp.competitorId}
                        enabled={comp.enabled}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
