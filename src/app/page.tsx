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

      <div style={{ display: 'flex', flexDirection: 'column', gap: 18, maxWidth: 440, width: '100%' }}>
        <section>
          <div
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              color: t.inkFaint,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              marginBottom: 7,
            }}
          >
            You&apos;re the partner
          </div>
          <p style={{ color: t.inkSoft, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
            Read each pair as if it&apos;s the language going into a deck that&apos;s about to land in
            front of the steerco. You&apos;re not grading effort — you&apos;re deciding which one
            you&apos;d actually be comfortable putting your name on.{' '}
            <strong style={{ color: t.ink, fontWeight: 600 }}>
              Tone, crispness, and nailing the key outputs are what matter most.
            </strong>
          </p>
        </section>

        <div style={{ height: 1, background: t.line }} />

        <section>
          <div
            style={{
              fontFamily: mono,
              fontSize: 10.5,
              color: t.inkFaint,
              letterSpacing: '.08em',
              textTransform: 'uppercase',
              marginBottom: 7,
            }}
          >
            How it works
          </div>
          <p style={{ color: t.inkSoft, fontSize: 13.5, lineHeight: 1.6, margin: 0 }}>
            Two outputs for the same task, blinded and in random order. Pick the stronger one —{' '}
            <strong style={{ color: t.ink, fontWeight: 600 }}>A</strong>,{' '}
            <strong style={{ color: t.ink, fontWeight: 600 }}>B</strong>, or{' '}
            <strong style={{ color: t.ink, fontWeight: 600 }}>tie</strong> — straight from the
            keyboard. If neither is good enough, rewrite it yourself; your version becomes a future
            blinded candidate. Every judgment feeds the rankings.
          </p>
        </section>
      </div>

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
