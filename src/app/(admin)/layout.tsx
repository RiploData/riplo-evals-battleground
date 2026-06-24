import type { ReactNode } from 'react';
import Link from 'next/link';
import { t, sans } from '@/ui/tokens';

export const metadata = { title: 'Riplo ARENA — Admin' };

export default function AdminLayout({ children }: { children: ReactNode }) {
  const navLinks: { href: string; label: string }[] = [
    { href: '/leaderboard', label: 'Leaderboard' },
    { href: '/reports', label: 'Reports' },
    { href: '/generate', label: 'Generate' },
    { href: '/cases', label: 'Cases' },
    { href: '/competitors', label: 'Competitors' },
  ];

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: t.paper,
        fontFamily: sans,
        color: t.ink,
      }}
    >
      {/* Top header */}
      <header
        style={{
          borderBottom: `1px solid ${t.line}`,
          backgroundColor: t.card,
          padding: '0 32px',
          display: 'flex',
          alignItems: 'center',
          gap: 32,
          height: 52,
        }}
      >
        <span
          style={{
            fontFamily: sans,
            fontWeight: 700,
            fontSize: 15,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: t.accent,
          }}
        >
          riplo <span style={{ color: t.ink }}>ARENA</span>
        </span>

        <span
          style={{
            width: 1,
            height: 20,
            backgroundColor: t.line,
            display: 'inline-block',
          }}
        />

        <span
          style={{
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.1em',
            textTransform: 'uppercase',
            color: t.inkFaint,
          }}
        >
          Admin
        </span>

        <nav style={{ display: 'flex', gap: 4, marginLeft: 'auto' }}>
          {navLinks.map((link) => (
            <Link
              key={link.href}
              href={link.href}
              style={{
                padding: '4px 12px',
                borderRadius: 6,
                fontSize: 13,
                fontWeight: 500,
                color: t.inkSoft,
                textDecoration: 'none',
                transition: 'background 0.15s, color 0.15s',
              }}
            >
              {link.label}
            </Link>
          ))}
        </nav>
      </header>

      {/* Page content */}
      <main style={{ maxWidth: 1200, margin: '0 auto', padding: '32px 32px 64px' }}>
        {children}
      </main>
    </div>
  );
}
