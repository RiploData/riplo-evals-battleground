import { requireUser, requireRole } from '@/auth/workos';
import { listCompetitorVersions } from '@/services/export';
import { t, sans, mono } from '@/ui/tokens';

export default async function CompetitorsPage() {
  const user = await requireUser();

  try {
    requireRole(user, 'analyst', 'operator', 'admin');
  } catch {
    return (
      <div style={{ color: '#b91c1c', fontFamily: sans, fontSize: 14 }}>
        Insufficient role — analyst, operator, or admin required.
      </div>
    );
  }

  const versions = await listCompetitorVersions();

  // Build a map from competitor_version_id → name for parent lineage display
  const idToName = new Map(
    versions.map((v) => [v.competitor_version_id, `${v.name} v${v.version}`]),
  );

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
          {versions.length} versions
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
        {versions.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: t.inkFaint, fontFamily: sans, fontSize: 14 }}>
            No competitor versions found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.line}`, backgroundColor: t.lineSoft }}>
                  {['Name', 'Version', 'Model identifier', 'Source type', 'Parent'].map((col) => (
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
                {versions.map((cv, i) => (
                  <tr
                    key={cv.competitor_version_id}
                    style={{
                      borderBottom: i < versions.length - 1 ? `1px solid ${t.lineSoft}` : 'none',
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
                      {cv.name}
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
                      v{cv.version}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: mono,
                        fontSize: 12,
                        color: t.inkSoft,
                      }}
                    >
                      {cv.model_identifier ?? (
                        <span style={{ color: t.inkFaint }}>—</span>
                      )}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: mono,
                        fontSize: 12,
                      }}
                    >
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          backgroundColor:
                            cv.source_type === 'manual' ? t.lineSoft : t.rewriteSoft,
                          color:
                            cv.source_type === 'manual' ? t.inkSoft : t.rewrite,
                          fontSize: 11,
                          fontWeight: 600,
                        }}
                      >
                        {cv.source_type}
                      </span>
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: sans,
                        fontSize: 12,
                        color: t.inkFaint,
                      }}
                    >
                      {cv.parent_competitor_version_id
                        ? (idToName.get(cv.parent_competitor_version_id) ??
                          cv.parent_competitor_version_id.slice(0, 8))
                        : '—'}
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
