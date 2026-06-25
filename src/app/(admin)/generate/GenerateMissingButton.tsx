'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { t, sans } from '@/ui/tokens';

interface Props {
  campaignId: string;
}

interface MissingResult {
  generated: number;
  skipped: number;
  failed: number;
  total: number;
}

export default function GenerateMissingButton({ campaignId }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<MissingResult | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleGenerate = async () => {
    setStatus('running');
    setResult(null);
    setErrorMsg('');

    try {
      const res = await fetch('/api/generate/missing', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId }),
      });

      if (!res.ok) {
        const body = (await res.json()) as { error?: { message?: string } };
        setErrorMsg(body.error?.message ?? 'Request failed');
        setStatus('error');
        return;
      }

      const data = (await res.json()) as MissingResult;
      setResult(data);
      setStatus('done');
      router.refresh();
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
        disabled={isRunning}
        style={{
          display: 'inline-flex',
          alignItems: 'center',
          gap: 8,
          padding: '10px 20px',
          borderRadius: 6,
          border: 'none',
          backgroundColor: isRunning ? t.lineSoft : t.accent,
          color: isRunning ? t.inkFaint : '#fff',
          fontFamily: sans,
          fontSize: 13,
          fontWeight: 600,
          cursor: isRunning ? 'not-allowed' : 'pointer',
          letterSpacing: '0.03em',
          alignSelf: 'flex-start',
        }}
      >
        {isRunning ? 'Generating…' : 'Generate all missing (eligible)'}
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
          Done — {result.generated} generated, {result.skipped} skipped, {result.failed} failed
          {' '}(total {result.total} cells).
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
