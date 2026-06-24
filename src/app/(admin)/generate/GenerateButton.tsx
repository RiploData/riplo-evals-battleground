'use client';

import { useState } from 'react';
import { t, sans } from '@/ui/tokens';

interface Props {
  campaignId: string;
  caseVersionIds: string[];
  competitorVersionIds: string[];
}

export default function GenerateButton({ campaignId, caseVersionIds, competitorVersionIds }: Props) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<{ enqueued: number; completed: number } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleGenerate = async () => {
    setStatus('running');
    setResult(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaignId, caseVersionIds, competitorVersionIds }),
      });

      if (!res.ok) {
        const body = await res.json() as { error?: { message?: string } };
        setErrorMsg(body.error?.message ?? 'Request failed');
        setStatus('error');
        return;
      }

      const data = await res.json() as { enqueued: number; completed: number };
      setResult(data);
      setStatus('done');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  };

  const isRunning = status === 'running';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <button
        onClick={handleGenerate}
        disabled={isRunning || caseVersionIds.length === 0 || competitorVersionIds.length === 0}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 20px',
          borderRadius: 6,
          border: 'none',
          backgroundColor:
            isRunning || caseVersionIds.length === 0 || competitorVersionIds.length === 0
              ? t.lineSoft
              : t.accent,
          color:
            isRunning || caseVersionIds.length === 0 || competitorVersionIds.length === 0
              ? t.inkFaint
              : '#fff',
          fontFamily: sans,
          fontSize: 13,
          fontWeight: 600,
          cursor:
            isRunning || caseVersionIds.length === 0 || competitorVersionIds.length === 0
              ? 'not-allowed'
              : 'pointer',
          letterSpacing: '0.03em',
          alignSelf: 'flex-start',
        }}
      >
        {isRunning ? 'Generating…' : 'Generate missing responses'}
      </button>

      {status === 'done' && result && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: t.accentSoft,
            borderRadius: 6,
            fontSize: 13,
            fontFamily: sans,
            color: t.accent,
          }}
        >
          Done — {result.completed}/{result.enqueued} cells completed.
        </div>
      )}

      {status === 'error' && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: '#fef2f2',
            borderRadius: 6,
            fontSize: 13,
            fontFamily: sans,
            color: '#b91c1c',
          }}
        >
          Error: {errorMsg}
        </div>
      )}
    </div>
  );
}
