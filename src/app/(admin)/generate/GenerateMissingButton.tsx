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
  remaining: number;
}

const MAX_ROUNDS = 60;

export default function GenerateMissingButton({ campaignId }: Props) {
  const router = useRouter();
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error' | 'stalled'>('idle');
  const [progress, setProgress] = useState<{
    generatedThisRun: number;
    total: number;
    remaining: number;
    failed: number;
  } | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const handleGenerate = async () => {
    setStatus('running');
    setProgress(null);
    setErrorMsg('');

    let generatedThisRun = 0;
    let lastRemaining = Infinity;

    try {
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const res = await fetch('/api/generate/missing', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ campaign_id: campaignId }),
        });
        if (!res.ok) {
          const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
          setErrorMsg(body.error?.message ?? `Request failed (${res.status})`);
          setStatus('error');
          return;
        }
        const data = (await res.json()) as MissingResult;
        generatedThisRun += data.generated;
        setProgress({ generatedThisRun, total: data.total, remaining: data.remaining, failed: data.failed });

        if (data.remaining === 0) {
          setStatus('done');
          router.refresh();
          return;
        }
        // No forward progress this round (nothing generated, or remaining not shrinking) → stop.
        if (data.generated === 0 || data.remaining >= lastRemaining) {
          setStatus('stalled');
          router.refresh();
          return;
        }
        lastRemaining = data.remaining;
      }
      setStatus('stalled'); // hit the round cap with work still remaining
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

      {(isRunning || status === 'done' || status === 'stalled') && progress && (
        <div
          style={{
            padding: '10px 14px',
            backgroundColor: status === 'done' ? t.accentSoft : t.lineSoft,
            borderRadius: 6,
            fontSize: 13,
            fontFamily: sans,
            color: status === 'done' ? t.accent : t.inkSoft,
          }}
        >
          {status === 'running' && (
            <>
              Generating… {progress.generatedThisRun} done this run · {progress.remaining} of{' '}
              {progress.total} cells remaining.
            </>
          )}
          {status === 'done' && (
            <>
              Done — all {progress.total} eligible cells have responses ({progress.generatedThisRun}{' '}
              generated this run).
            </>
          )}
          {status === 'stalled' && (
            <>
              Stopped — {progress.generatedThisRun} generated this run, {progress.remaining} still
              missing
              {progress.failed > 0
                ? ` (${progress.failed} failed in the last round — check API keys / rate limits, then run again).`
                : ' (no further progress; run again to retry).'}
            </>
          )}
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
