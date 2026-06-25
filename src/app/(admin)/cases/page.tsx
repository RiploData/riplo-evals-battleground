import { requireUser, requireRole } from '@/auth/workos';
import { listCasesWithEligibility } from '@/services/admin';
import { t, sans, mono } from '@/ui/tokens';
import CaseEligibilityControl from './CaseEligibilityControl';

export default async function CasesPage() {
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

  const cases = await listCasesWithEligibility();

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
          {cases.length} cases
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
                  {['External ref', 'Kind', 'Title', 'Split', 'In-git', 'Default', 'Effective', 'Override'].map(
                    (col) => (
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
                    ),
                  )}
                </tr>
              </thead>
              <tbody>
                {cases.map((c, i) => (
                  <tr
                    key={c.caseId}
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
                      {c.externalRef ?? '—'}
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
                        maxWidth: 320,
                      }}
                    >
                      {c.title}
                    </td>
                    <td
                      style={{
                        padding: '10px 14px',
                        fontFamily: mono,
                        fontSize: 12,
                        color: t.inkSoft,
                      }}
                    >
                      {c.datasetSplit}
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontFamily: sans,
                          fontWeight: 600,
                          backgroundColor: c.retiredAt ? '#fef2f2' : t.accentSoft,
                          color: c.retiredAt ? '#b91c1c' : t.accent,
                        }}
                      >
                        {c.retiredAt ? 'removed' : 'present'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontFamily: sans,
                          fontWeight: 600,
                          backgroundColor: c.defaultEligible ? t.accentSoft : t.lineSoft,
                          color: c.defaultEligible ? t.accent : t.inkFaint,
                        }}
                      >
                        {c.defaultEligible ? 'yes' : 'no'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <span
                        style={{
                          padding: '2px 8px',
                          borderRadius: 4,
                          fontSize: 11,
                          fontFamily: sans,
                          fontWeight: 600,
                          backgroundColor: c.effectiveEligible ? t.accentSoft : t.lineSoft,
                          color: c.effectiveEligible ? t.accent : t.inkFaint,
                        }}
                      >
                        {c.effectiveEligible ? 'yes' : 'no'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 14px' }}>
                      <CaseEligibilityControl caseId={c.caseId} current={c.eligibleOverride} />
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
