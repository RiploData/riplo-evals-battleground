'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Check, PenLine, CornerDownLeft, ArrowUp, ArrowDown, Pencil, ArrowLeft, FileText, List } from 'lucide-react';
import { t, sans, serif, mono } from '@/ui/tokens';
import type { BattlePayload, BattleOption, VoteRequest, Outcome, RewriteForkedFrom } from '@/types/contracts';

// ── Types ────────────────────────────────────────────────────────
type Mode = 'idle' | 'choosing' | 'rewriting';
type FlashState = { label: string } | null;

// ── Vote sub-component ───────────────────────────────────────────
interface VoteProps {
  label: string;
  hint: string;
  onClick: () => void;
  icon?: React.ReactNode;
  subtle?: boolean;
  hovered: boolean;
  onEnter: () => void;
  onLeave: () => void;
}

function Vote({ label, hint, onClick, icon, subtle = false, hovered, onEnter, onLeave }: VoteProps) {
  const bg = subtle ? (hovered ? '#fff' : 'transparent') : (hovered ? t.accent : t.card);
  const fg = subtle ? t.inkSoft : (hovered ? '#fff' : t.ink);
  const bd = subtle ? t.line : (hovered ? t.accent : t.line);
  return (
    <button
      onClick={onClick}
      onMouseEnter={onEnter}
      onMouseLeave={onLeave}
      style={{
        padding: '13px 16px', borderRadius: 10, border: `1px solid ${bd}`, background: bg, color: fg,
        fontWeight: 600, fontSize: 14, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
        transition: 'background .14s, color .14s, border-color .14s',
      }}
    >
      {icon}{label}
      <span
        className="kbd"
        style={{
          color: hovered && !subtle ? 'rgba(255,255,255,.7)' : t.inkFaint,
          borderColor: hovered && !subtle ? 'rgba(255,255,255,.3)' : t.line,
        }}
      >
        {hint}
      </span>
    </button>
  );
}

// ── Main component ───────────────────────────────────────────────
export default function BattleClient() {
  const [payload, setPayload] = useState<BattlePayload | null>(null);
  const [allDone, setAllDone] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('idle');
  const [base, setBase] = useState<RewriteForkedFrom | null>(null);
  const [draft, setDraft] = useState('');
  const [flash, setFlash] = useState<FlashState>(null);
  const [count, setCount] = useState(0);
  const [hover, setHover] = useState<string | null>(null);

  // Timing refs — reset when a new battle arrives
  const battleStartRef = useRef<number>(Date.now());
  const firstActionRef = useRef<number | null>(null);

  // ── Fetch next battle ──────────────────────────────────────────
  const fetchBattle = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/battle');
      if (res.status === 204) {
        setAllDone(true);
        setPayload(null);
        return;
      }
      if (!res.ok) {
        setError(`Failed to load battle (${res.status})`);
        return;
      }
      const data: BattlePayload = await res.json();
      setPayload(data);
      setAllDone(false);
      setMode('idle');
      setBase(null);
      setDraft('');
      // Reset timing
      battleStartRef.current = Date.now();
      firstActionRef.current = null;
    } catch {
      setError('Network error — could not load battle.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchBattle(); }, [fetchBattle]);

  // ── Record first action ────────────────────────────────────────
  const recordFirstAction = useCallback(() => {
    if (firstActionRef.current === null) {
      firstActionRef.current = Date.now() - battleStartRef.current;
    }
  }, []);

  // ── Post vote ─────────────────────────────────────────────────
  const postVote = useCallback(async (body: VoteRequest): Promise<boolean> => {
    try {
      const res = await fetch('/api/vote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return res.status === 201;
    } catch {
      return false;
    }
  }, []);

  // ── Cast a plain vote (A / B / Tie) ───────────────────────────
  const cast = useCallback(async (outcome: Outcome, label: string) => {
    if (!payload) return;
    recordFirstAction();
    const now = Date.now();
    const body: VoteRequest = {
      assignment_id: payload.assignment_id,
      outcome,
      time_to_first_action_ms: firstActionRef.current ?? (now - battleStartRef.current),
      total_duration_ms: now - battleStartRef.current,
    };
    const ok = await postVote(body);
    if (ok) {
      setFlash({ label });
      setCount((c) => c + 1);
      setTimeout(() => {
        setFlash(null);
        fetchBattle();
      }, 600);
    }
  }, [payload, recordFirstAction, postVote, fetchBattle]);

  // ── Rewrite helpers ────────────────────────────────────────────
  const startRewrite = useCallback((from: RewriteForkedFrom) => {
    if (!payload) return;
    recordFirstAction();
    // Map 'a' → options[0].body_text, 'b' → options[1].body_text
    const textFor = (f: RewriteForkedFrom) => {
      if (f === 'scratch') return '';
      const idx = f === 'a' ? 0 : 1;
      return payload.options[idx]?.body_text ?? '';
    };
    setBase(from);
    setDraft(textFor(from));
    setMode('rewriting');
  }, [payload, recordFirstAction]);

  const submitRewrite = useCallback(async () => {
    if (!draft.trim() || !payload || !base) return;
    const now = Date.now();
    const body: VoteRequest = {
      assignment_id: payload.assignment_id,
      outcome: 'both_unacceptable',
      time_to_first_action_ms: firstActionRef.current ?? (now - battleStartRef.current),
      total_duration_ms: now - battleStartRef.current,
      rewrite: { forked_from: base, body_text: draft.trim() },
    };
    const label = base === 'scratch'
      ? 'Rewrite saved (from scratch)'
      : `Rewrite saved (from ${base.toUpperCase()})`;
    const ok = await postVote(body);
    if (ok) {
      setFlash({ label });
      setCount((c) => c + 1);
      setTimeout(() => {
        setFlash(null);
        fetchBattle();
      }, 600);
    }
  }, [draft, payload, base, postVote, fetchBattle]);

  // ── Keyboard handler ───────────────────────────────────────────
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (mode === 'rewriting') {
        if (e.key === 'Escape') setMode('idle');
        return;
      }
      if (mode === 'choosing') {
        if (e.key === 'Escape') setMode('idle');
        else if (e.key.toLowerCase() === 'a') startRewrite('a');
        else if (e.key.toLowerCase() === 'b') startRewrite('b');
        else if (e.key.toLowerCase() === 's') startRewrite('scratch');
        return;
      }
      const k = e.key.toLowerCase();
      if (k === 'a') cast('left', 'A is better');
      else if (k === 'b') cast('right', 'B is better');
      else if (k === 't') cast('tie', 'Tie');
      else if (k === 'r') setMode('choosing');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [mode, cast, startRewrite]);

  // ── Render helpers ────────────────────────────────────────────
  const task = payload?.task;
  // Server already fixed order: options[0] = A (top), options[1] = B (bottom)
  const options: BattleOption[] = payload?.options ?? [];

  const renderOption = (opt: BattleOption) => (
    <article
      key={opt.label}
      className="opt"
      style={{
        background: t.card, border: `1px solid ${t.line}`,
        borderRadius: 14, padding: '16px 18px 18px',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
        <span style={{
          fontFamily: mono, fontSize: 13, fontWeight: 600, border: `1px solid ${t.line}`,
          borderRadius: 7, width: 26, height: 26, display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        }}>
          {opt.label}
        </span>
        <button
          onClick={() => startRewrite(opt.label.toLowerCase() as RewriteForkedFrom)}
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12, fontWeight: 500,
            color: t.rewrite, border: `1px solid ${t.rewriteSoft}`, background: '#FDFBF8', padding: '5px 10px', borderRadius: 8,
          }}
        >
          <Pencil size={12.5} /> Rewrite this version
        </button>
      </div>
      {/* body_text only — provenance and length never shown */}
      <p style={{ margin: 0, fontFamily: serif, fontSize: 15, lineHeight: 1.62, color: t.ink }}>
        {opt.body_text}
      </p>
    </article>
  );

  // ── Render ────────────────────────────────────────────────────
  return (
    <div style={{ background: t.paper, fontFamily: sans, color: t.ink, minHeight: '100vh' }}>
      <style>{`
        .arena * { box-sizing: border-box; }
        .arena button { font-family: inherit; cursor: pointer; border: none; background: none; }
        .arena button:focus-visible { outline: 2px solid ${t.accent}; outline-offset: 2px; }
        .kbd { font-family: ${mono}; font-size: 10px; letter-spacing:.04em; color:${t.inkFaint};
               border:1px solid ${t.line}; border-radius:4px; padding:1px 5px; }
        .opt { transition: box-shadow .18s ease, border-color .18s ease; }
        .opt:hover { box-shadow: 0 6px 22px rgba(20,20,26,.06); }
        .scroll::-webkit-scrollbar { width: 8px; } .scroll::-webkit-scrollbar-thumb { background:${t.line}; border-radius:99px; }
        .reveal { animation: fade .2s ease both; }
        @keyframes fade { from{opacity:0;transform:translateY(4px);} to{opacity:1;transform:none;} }
        @media (max-width: 880px){ .panes{ grid-template-columns:1fr !important; height:auto !important; }
          .pane{ height:auto !important; max-height:none !important; } }
        @media (prefers-reduced-motion: reduce){ .reveal{animation:none;} .opt{transition:none;} }
      `}</style>

      <div className="arena" style={{ maxWidth: 1180, margin: '0 auto', padding: '0 22px' }}>
        {/* ── Header ── */}
        <header style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '16px 0 14px', borderBottom: `1px solid ${t.line}`,
        }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
            <span style={{ fontWeight: 600 }}>riplo</span>
            <span style={{ color: t.inkFaint, fontFamily: mono, fontSize: 12, letterSpacing: '.06em' }}>ARENA</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 7, fontSize: 12.5, color: t.inkSoft }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: t.accent }} /> Blinded · randomised
            </span>
            <span style={{ fontSize: 12.5, color: t.inkFaint }}>
              <b style={{ color: t.ink, fontWeight: 600 }}>{count}</b> judged this session
            </span>
          </div>
        </header>

        {/* ── Loading / Error / All Done states ── */}
        {loading && (
          <div style={{ padding: '60px 0', textAlign: 'center', color: t.inkFaint, fontSize: 14 }}>
            Loading…
          </div>
        )}

        {!loading && error && (
          <div style={{ padding: '60px 0', textAlign: 'center', color: t.rewrite, fontSize: 14 }}>
            {error}
            <br />
            <button
              onClick={fetchBattle}
              style={{ marginTop: 16, padding: '8px 18px', borderRadius: 8, border: `1px solid ${t.line}`, background: t.card, cursor: 'pointer', fontSize: 13 }}
            >
              Retry
            </button>
          </div>
        )}

        {!loading && allDone && (
          <div style={{ padding: '60px 0', textAlign: 'center', color: t.inkSoft, fontSize: 15 }}>
            All caught up — no more battles right now.
          </div>
        )}

        {/* ── Main panes ── */}
        {!loading && !error && payload && task && (
          <div
            className="panes"
            style={{
              display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 22,
              height: '82vh', minHeight: 560, padding: '20px 0 24px',
            }}
          >
            {/* ── LEFT: task context ── */}
            <div
              className="pane"
              style={{
                display: 'flex', flexDirection: 'column', minHeight: 0,
                background: t.card, border: `1px solid ${t.line}`, borderRadius: 14, overflow: 'hidden',
              }}
            >
              <div style={{ padding: '20px 22px 16px', borderBottom: `1px solid ${t.lineSoft}` }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                  <span style={{ fontFamily: mono, fontSize: 11.5, color: t.inkFaint, letterSpacing: '.05em' }}>
                    TASK {task.case_external_ref}
                  </span>
                  <span style={{
                    fontFamily: mono, fontSize: 10.5, color: t.accent, background: t.accentSoft,
                    padding: '2px 8px', borderRadius: 99, textTransform: 'uppercase', letterSpacing: '.04em',
                  }}>
                    {task.kind}
                  </span>
                </div>
                <h1 style={{ margin: 0, fontSize: 20, lineHeight: 1.25, letterSpacing: '-.015em', fontWeight: 600 }}>
                  {task.title}
                </h1>
                {task.guidance && (
                  <p style={{ margin: '10px 0 0', color: t.inkSoft, fontSize: 13.5, lineHeight: 1.55 }}>
                    {task.guidance}
                  </p>
                )}
              </div>

              <div style={{ padding: '14px 22px', borderBottom: `1px solid ${t.lineSoft}` }}>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                  <span style={{ fontFamily: mono, fontSize: 10.5, color: t.inkFaint, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                    What we&apos;re building
                  </span>
                  <span style={{ fontSize: 12, fontWeight: 600, color: t.accent }}>{task.output_spec.target}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {task.output_spec.parts.map((p, i) => (
                    <div
                      key={i}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 10, padding: '8px 11px',
                        background: t.paper, border: `1px solid ${t.lineSoft}`, borderRadius: 9,
                      }}
                    >
                      {p.type === 'bullets'
                        ? <List size={14} color={t.inkSoft} />
                        : <FileText size={14} color={t.inkSoft} />}
                      <span style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</span>
                      {p.note && (
                        <span style={{ marginLeft: 'auto', fontFamily: mono, fontSize: 10.5, color: t.inkFaint }}>
                          {p.note}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              </div>

              <div style={{ padding: '14px 22px 6px' }}>
                <span style={{ fontFamily: mono, fontSize: 10.5, color: t.inkFaint, letterSpacing: '.08em', textTransform: 'uppercase' }}>
                  Source material
                </span>
              </div>
              <div className="scroll" style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: '0 22px 22px' }}>
                {task.source_blocks.map((block, i) =>
                  block.type === 'bullets' ? (
                    <ul key={i} style={{ margin: i ? '10px 0 0' : 0, paddingLeft: 18, fontFamily: serif, fontSize: 14.5, lineHeight: 1.66, color: t.ink }}>
                      {block.items.map((item, j) => <li key={j} style={{ marginBottom: 4 }}>{item}</li>)}
                    </ul>
                  ) : (
                    <p key={i} style={{ margin: i ? '12px 0 0' : '0', fontFamily: serif, fontSize: 14.5, lineHeight: 1.64, color: t.ink }}>
                      {block.text}
                    </p>
                  )
                )}
              </div>
            </div>

            {/* ── RIGHT: options + actions ── */}
            <div className="pane" style={{ display: 'flex', flexDirection: 'column', minHeight: 0 }}>
              {mode !== 'rewriting' && (
                <>
                  <div
                    className="scroll"
                    style={{
                      flex: 1, minHeight: 0, overflow: 'auto', display: 'flex',
                      flexDirection: 'column', gap: 14, paddingRight: 2,
                    }}
                  >
                    {options.map((opt) => renderOption(opt))}
                  </div>

                  <div style={{ paddingTop: 14 }}>
                    {mode === 'idle' && (
                      <>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr auto 1fr', gap: 10 }}>
                          <Vote
                            label="A is better" hint="A" icon={<ArrowUp size={15} />}
                            hovered={hover === 'a'} onEnter={() => setHover('a')} onLeave={() => setHover(null)}
                            onClick={() => cast('left', 'A is better')}
                          />
                          <Vote
                            label="Tie" hint="T" subtle
                            hovered={hover === 't'} onEnter={() => setHover('t')} onLeave={() => setHover(null)}
                            onClick={() => cast('tie', 'Tie')}
                          />
                          <Vote
                            label="B is better" hint="B" icon={<ArrowDown size={15} />}
                            hovered={hover === 'b'} onEnter={() => setHover('b')} onLeave={() => setHover(null)}
                            onClick={() => cast('right', 'B is better')}
                          />
                        </div>
                        <button
                          onClick={() => setMode('choosing')}
                          onMouseEnter={() => setHover('r')}
                          onMouseLeave={() => setHover(null)}
                          style={{
                            marginTop: 10, width: '100%', padding: 11, borderRadius: 10,
                            border: `1px dashed ${hover === 'r' ? t.rewrite : t.line}`,
                            color: hover === 'r' ? t.rewrite : t.inkSoft,
                            fontSize: 13, fontWeight: 500, display: 'inline-flex', alignItems: 'center',
                            justifyContent: 'center', gap: 8, transition: 'border-color .14s, color .14s',
                          }}
                        >
                          <PenLine size={14} /> Neither — rewrite <span className="kbd">R</span>
                        </button>
                        <div style={{ marginTop: 12, textAlign: 'center', fontSize: 11.5, color: t.inkFaint }}>
                          <span className="kbd">A</span> · <span className="kbd">B</span> · <span className="kbd">T</span> tie · <span className="kbd">R</span> rewrite
                        </div>
                      </>
                    )}

                    {mode === 'choosing' && (
                      <div className="reveal" style={{ border: `1px solid ${t.rewriteSoft}`, background: '#FDFBF8', borderRadius: 12, padding: 14 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: t.rewrite, marginBottom: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span>Rewrite from…</span>
                          <button onClick={() => setMode('idle')} style={{ fontSize: 12, color: t.inkSoft, fontWeight: 500 }}>
                            Cancel <span className="kbd">Esc</span>
                          </button>
                        </div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10 }}>
                          {([
                            { k: 'a' as const, l: 'Version A', h: 'A' },
                            { k: 'b' as const, l: 'Version B', h: 'B' },
                            { k: 'scratch' as const, l: 'Scratch', h: 'S' },
                          ]).map((o) => (
                            <button
                              key={o.k}
                              onClick={() => startRewrite(o.k)}
                              style={{
                                padding: '12px 10px', borderRadius: 9, border: `1px solid ${t.line}`, background: t.card,
                                color: t.ink, fontSize: 13, fontWeight: 600, display: 'inline-flex', alignItems: 'center',
                                justifyContent: 'center', gap: 7,
                              }}
                            >
                              {o.l} <span className="kbd">{o.h}</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {mode === 'rewriting' && (
                <div
                  className="reveal"
                  style={{
                    flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column',
                    border: `1px solid ${t.rewriteSoft}`, background: '#FDFBF8', borderRadius: 14, padding: 18,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <PenLine size={15} color={t.rewrite} />
                      <span style={{ fontWeight: 600, fontSize: 14, color: t.rewrite }}>
                        {base === 'scratch' ? 'Your version' : `Editing from ${base?.toUpperCase()}`}
                      </span>
                    </div>
                    <button
                      onClick={() => setMode('idle')}
                      style={{ display: 'inline-flex', alignItems: 'center', gap: 5, fontSize: 12.5, color: t.inkSoft }}
                    >
                      <ArrowLeft size={13} /> Back <span className="kbd">Esc</span>
                    </button>
                  </div>
                  <p style={{ margin: '0 0 12px', fontSize: 12, color: t.inkFaint }}>
                    {base === 'scratch'
                      ? 'A blinded candidate in future battles.'
                      : `Starting from ${base?.toUpperCase()} records it as the closer of the two. Becomes a blinded candidate.`}
                  </p>
                  <textarea
                    autoFocus
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    style={{
                      flex: 1, minHeight: 0, width: '100%', resize: 'none', padding: '14px 16px', fontFamily: serif,
                      fontSize: 15, lineHeight: 1.6, color: t.ink, background: t.card,
                      border: `1px solid ${t.line}`, borderRadius: 10, outline: 'none',
                    }}
                  />
                  <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                      onClick={submitRewrite}
                      disabled={!draft.trim()}
                      style={{
                        padding: '10px 18px', borderRadius: 9,
                        background: draft.trim() ? t.rewrite : t.lineSoft,
                        color: draft.trim() ? '#fff' : t.inkFaint,
                        fontWeight: 600, fontSize: 13.5, display: 'inline-flex', alignItems: 'center', gap: 8,
                      }}
                    >
                      Save &amp; continue <CornerDownLeft size={14} />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Flash toast ── */}
      {flash && (
        <div style={{
          position: 'fixed', bottom: 26, left: '50%', transform: 'translateX(-50%)',
          background: t.ink, color: '#fff', padding: '11px 20px', borderRadius: 99,
          fontSize: 13.5, fontWeight: 500, display: 'inline-flex', alignItems: 'center', gap: 9,
          boxShadow: '0 8px 30px rgba(20,20,26,.22)',
        }}>
          <Check size={15} /> {flash.label}
        </div>
      )}
    </div>
  );
}
