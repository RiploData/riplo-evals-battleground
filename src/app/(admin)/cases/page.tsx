import { requireUser, requireRole } from '@/auth/workos';
import { listCases } from '@/services/export';
import { t, sans, mono } from '@/ui/tokens';

export default async function CasesPage() {
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

  const cases = await listCases();

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
          Cases
        </h1>
        <span
          style={{
            fontSize: 13,
            color: t.inkFaint,
            fontFamily: sans,
          }}
        >
          {cases.length} case versions
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
        {cases.length === 0 ? (
          <div style={{ padding: 32, textAlign: 'center', color: t.inkFaint, fontFamily: sans, fontSize: 14 }}>
            No cases found.
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${t.line}`, backgroundColor: t.lineSoft }}>
                  {['External ref', 'Kind', 'Title', 'Tags', 'Split'].map((col) => (
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
                {cases.map((c, i) => (
                  <tr
                    key={c.case_version_id}
                    style={{
                      borderBottom: i < cases.length - 1 ? `1px solid ${t.lineSoft}` : 'none',
                      backgroundColor: i % 2 === 0 ? t.card : '#FAFAF8',
                    }}
                  >
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: mono,
                        fontSize: 12,
                        color: t.inkSoft,
                        whiteSpace: 'nowrap' as const,
                      }}
                    >
                      {c.external_ref ?? '—'}
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
                      {c.kind}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: sans,
                        fontSize: 13,
                        color: t.ink,
                        maxWidth: 400,
                      }}
                    >
                      {c.title}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      {c.tags.length === 0 ? (
                        <span style={{ color: t.inkFaint, fontSize: 12, fontFamily: sans }}>—</span>
                      ) : (
                        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' as const }}>
                          {c.tags.map((tag) => (
                            <span
                              key={tag}
                              style={{
                                padding: '2px 8px',
                                borderRadius: 4,
                                backgroundColor: t.accentSoft,
                                color: t.accent,
                                fontSize: 11,
                                fontFamily: sans,
                                fontWeight: 600,
                              }}
                            >
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: mono,
                        fontSize: 12,
                        color: t.inkSoft,
                      }}
                    >
                      {c.dataset_split}
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
