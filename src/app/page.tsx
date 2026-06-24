import Link from 'next/link';
import { t, sans, mono } from '@/ui/tokens';

export default function Home() {
  return (
    <main
      style={{
        background: t.paper,
        color: t.ink,
        fontFamily: sans,
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 28,
        padding: 24,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
        <span style={{ fontWeight: 600, fontSize: 28 }}>riplo</span>
        <span
          style={{
            color: t.inkFaint,
            fontFamily: mono,
            fontSize: 16,
            letterSpacing: '.08em',
          }}
        >
          ARENA
        </span>
      </div>
      <p style={{ color: t.inkSoft, fontSize: 15, margin: 0, maxWidth: 440, textAlign: 'center' }}>
        Blinded preference arena. Compare two anonymised outputs, pick the better one, and let the
        judgments accumulate into rankings.
      </p>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link
          href="/battle"
          style={{
            background: t.accent,
            color: '#fff',
            padding: '12px 22px',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Start rating →
        </Link>
        <Link
          href="/leaderboard"
          style={{
            background: t.card,
            color: t.ink,
            border: `1px solid ${t.line}`,
            padding: '12px 22px',
            borderRadius: 10,
            fontSize: 14,
            fontWeight: 600,
            textDecoration: 'none',
          }}
        >
          Admin & leaderboard
        </Link>
      </div>
    </main>
  );
}
