'use client';

import { useState } from 'react';
import { t, sans } from '@/ui/tokens';

export default function RunRankingButton({ campaignId }: { campaignId: string }) {
  const [status, setStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle');
  const [message, setMessage] = useState('');

  const handleRun = async () => {
    setStatus('running');
    setMessage('');
    try {
      const res = await fetch('/api/ranking-runs', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: campaignId }),
      });
      if (!res.ok) {
        const body = await res.json() as { error?: { message?: string } };
        setMessage(body.error?.message ?? 'Request failed');
        setStatus('error');
        return;
      }
      const data = await res.json() as { rankingRunId?: string };
      setMessage(`Run created: ${data.rankingRunId ?? '—'}`);
      setStatus('done');
      // Refresh the page after a short delay so the leaderboard table updates
      setTimeout(() => window.location.reload(), 800);
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Unknown error');
      setStatus('error');
    }
  };

  const isRunning = status === 'running';

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
      <button
        onClick={handleRun}
        disabled={isRunning}
        style={{
          padding: '8px 18px',
          borderRadius: 6,
          border: 'none',
          backgroundColor: isRunning ? t.lineSoft : t.accent,
          color: isRunning ? t.inkFaint : '#fff',
          fontFamily: sans,
          fontSize: 13,
          fontWeight: 600,
          cursor: isRunning ? 'not-allowed' : 'pointer',
          letterSpacing: '0.03em',
          transition: 'background 0.15s',
        }}
      >
        {isRunning ? 'Running…' : 'Run ranking'}
      </button>

      {message && (
        <span
          style={{
            fontSize: 12,
            color: status === 'error' ? '#b91c1c' : t.inkSoft,
            fontFamily: sans,
          }}
        >
          {message}
        </span>
      )}
    </div>
  );
}
