'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, sans } from '@/ui/tokens';

interface Props {
  competitorId: string;
  enabled: boolean;
}

export default function CompetitorToggle({ competitorId, enabled: initialEnabled }: Props) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [saving, setSaving] = useState(false);

  const handleChange = async (next: boolean) => {
    setEnabled(next);
    setSaving(true);
    try {
      await fetch('/api/competitors/enabled', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ competitor_id: competitorId, enabled: next }),
      });
      router.refresh();
    } finally {
      setSaving(false);
    }
  };

  return (
    <label
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        cursor: saving ? 'not-allowed' : 'pointer',
        fontFamily: sans,
        fontSize: 12,
        color: enabled ? t.accent : t.inkFaint,
        userSelect: 'none' as const,
      }}
    >
      <input
        type="checkbox"
        checked={enabled}
        disabled={saving}
        onChange={e => handleChange(e.target.checked)}
        style={{ accentColor: t.accent, cursor: saving ? 'not-allowed' : 'pointer' }}
      />
      {enabled ? 'Enabled' : 'Disabled'}
    </label>
  );
}
