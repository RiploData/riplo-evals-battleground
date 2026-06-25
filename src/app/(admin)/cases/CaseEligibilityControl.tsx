'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, sans } from '@/ui/tokens';

interface Props {
  caseId: string;
  current: boolean | null; // current eligibleOverride
}

type SelectValue = 'default' | 'force-in' | 'force-out';

function overrideToSelect(v: boolean | null): SelectValue {
  if (v === true) return 'force-in';
  if (v === false) return 'force-out';
  return 'default';
}

function selectToOverride(v: SelectValue): boolean | null {
  if (v === 'force-in') return true;
  if (v === 'force-out') return false;
  return null;
}

export default function CaseEligibilityControl({ caseId, current }: Props) {
  const router = useRouter();
  const [value, setValue] = useState<SelectValue>(overrideToSelect(current));
  const [saving, setSaving] = useState(false);

  const handleChange = async (next: SelectValue) => {
    setValue(next);
    setSaving(true);
    try {
      await fetch('/api/cases/eligibility', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ case_id: caseId, override: selectToOverride(next) }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <select
      value={value}
      disabled={saving}
      onChange={e => handleChange(e.target.value as SelectValue)}
      style={{
        fontFamily: sans,
        fontSize: 12,
        padding: '3px 6px',
        borderRadius: 4,
        border: `1px solid ${t.line}`,
        backgroundColor: saving ? t.lineSoft : t.card,
        color: t.ink,
        cursor: saving ? 'not-allowed' : 'pointer',
      }}
    >
      <option value="default">Default</option>
      <option value="force-in">Force in</option>
      <option value="force-out">Force out</option>
    </select>
  );
}
