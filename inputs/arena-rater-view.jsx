import React, { useState, useEffect, useCallback } from "react";
import { Check, PenLine, CornerDownLeft, ArrowUp, ArrowDown, Pencil, ArrowLeft, FileText, List } from "lucide-react";

// ── Design tokens ───────────────────────────────────────────────
const t = {
  paper: "#F4F3EE", card: "#FFFFFF", ink: "#17171B", inkSoft: "#5B5A63",
  inkFaint: "#8E8D95", line: "#E4E2DB", lineSoft: "#EEEDE7",
  accent: "#34566F", accentSoft: "#E8EEF2", rewrite: "#7A5B3A", rewriteSoft: "#F1EAE0",
};
const sans = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif";
const serif = "Georgia, 'Times New Roman', serif";
const mono = "ui-monospace, 'SF Mono', Menlo, Consolas, monospace";

// Mock battles. In production these arrive blinded from GET /battle — no competitor identity.
const BATTLES = [
  {
    id: "0142", kind: "compression",
    title: "Compress this diligence memo to its decision-relevant core",
    guidance: "Reward the version that helps a partner reach a call, not the one that recaps the most.",
    outputSpec: { target: "Investment committee one-pager", parts: [
      { type: "title", label: "Headline", note: "one line" },
      { type: "bullets", label: "Key supporting points", note: "3 bullets" },
    ] },
    source: [
      { type: "text", text: "UK facilities-management vertical SaaS. Priced at 8.5x ARR; CFO seat vacant." },
      { type: "bullets", items: [
        "£14m ARR, growing 31% YoY",
        "Retention: 91% gross, 108% net — sticky via SFG20 compliance workflow",
        "Dated codebase; founder-CTO is a single point of failure",
        "Mgmt projects 40% growth; pipeline only supports ~28%",
        "Analytics module cross-sell upside (4% of revenue today)",
        "Top 10 accounts = 22% of ARR",
      ] },
    ],
    a: "Sticky vertical SaaS (£14m ARR, 31% YoY) defended by compliance-workflow lock-in, not features. Two real risks: founder-CTO key-person exposure on a dated codebase, and a 40% growth plan the pipeline only supports to ~28%. Priced at 8.5x ARR — the case rests on whether analytics cross-sell (4% today) and durable retention (108% net) justify the gap. Decision hinges on key-person mitigation and a defensible growth bridge.",
    b: "This is a UK facilities-management vertical SaaS business with approximately £14m of ARR growing at 31% year-on-year. Retention is strong, with gross retention at 91% and net retention at 108%, driven by high switching costs related to its position in the SFG20 compliance workflow. There are some risks worth noting, including a dated codebase and reliance on the founder-CTO, as well as a gap between management's 40% growth projection and pipeline data supporting around 28%. The valuation is 8.5x ARR, and there is potential upside from the analytics module and moderate customer concentration.",
  },
  {
    id: "0143", kind: "judgment",
    title: "What is the single most important thing here?",
    guidance: "Reward insight and restraint over coverage — the one thing that should change the decision.",
    outputSpec: { target: "Board slide", parts: [
      { type: "title", label: "Slide title", note: "one line" },
      { type: "text", label: "Lead insight", note: "1–2 sentences" },
    ] },
    source: [
      { type: "text", text: "A portfolio company missed its quarterly revenue target by 6%. The CRO has proposed increasing marketing spend 30% to 'refill the top of funnel.'" },
      { type: "bullets", items: [
        "MQLs up 22% QoQ", "SQLs flat", "Win rate stable at 24%", "Two senior AEs resigned this quarter",
      ] },
    ],
    a: "The top of funnel isn't the problem — MQLs are up 22% while SQLs are flat. Leads are arriving and dying at qualification, and two senior AEs just walked. Spending 30% more on marketing pours water into a leaking middle. The real question is why qualified demand isn't converting to pipeline, and whether the AE departures are cause or symptom.",
    b: "There are several factors contributing to the revenue miss. The enterprise sales cycle has lengthened, which sales leadership has identified as a key driver. At the same time, MQLs have grown 22% while SQLs are flat, win rates are stable, and two account executives have left. The CRO's proposal to increase marketing spend by 30% may help refill the funnel, though the team should also consider sales capacity and the MQL-to-SQL conversion.",
  },
];

export default function ArenaRaterView() {
  const [idx, setIdx] = useState(0);
  const [top, setTop] = useState("a");            // which option renders on top — re-rolled per battle
  const [mode, setMode] = useState("idle");        // 'idle' | 'choosing' | 'rewriting'
  const [base, setBase] = useState(null);          // 'a' | 'b' | 'scratch'
  const [draft, setDraft] = useState("");
  const [flash, setFlash] = useState(null);
  const [count, setCount] = useState(0);
  const [hover, setHover] = useState(null);

  const battle = BATTLES[idx % BATTLES.length];
  const order = top === "a" ? ["a", "b"] : ["b", "a"];

  const advance = useCallback(() => {
    setIdx((i) => i + 1); setTop(Math.random() < 0.5 ? "a" : "b");
    setMode("idle"); setBase(null); setDraft("");
  }, []);
  const cast = useCallback((label) => {
    setFlash({ label }); setCount((c) => c + 1);
    setTimeout(() => { setFlash(null); advance(); }, 600);
  }, [advance]);
  const startRewrite = useCallback((from) => {
    setBase(from); setDraft(from === "scratch" ? "" : battle[from]); setMode("rewriting");
  }, [battle]);
  const submitRewrite = useCallback(() => {
    if (!draft.trim()) return;
    cast(base === "scratch" ? "Rewrite saved (from scratch)" : `Rewrite saved (from ${base.toUpperCase()})`);
  }, [draft, base, cast]);

  useEffect(() => {
    const onKey = (e) => {
      if (mode === "rewriting") { if (e.key === "Escape") setMode("idle"); return; }
      if (mode === "choosing") {
        if (e.key === "Escape") setMode("idle");
        else if (e.key.toLowerCase() === "a") startRewrite("a");
        else if (e.key.toLowerCase() === "b") startRewrite("b");
        else if (e.key.toLowerCase() === "s") startRewrite("scratch");
        return;
      }
      const k = e.key.toLowerCase();
      if (k === "a") cast("A is better");
      else if (k === "b") cast("B is better");
      else if (k === "t") cast("Tie");
      else if (k === "r") setMode("choosing");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, cast, startRewrite]);

  return (
    <div style={{ background: t.paper, fontFamily: sans, color: t.ink, minHeight: "100vh" }}>
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

      <div className="arena" style={{ maxWidth: 1180, margin: "0 auto", padding: "0 22px" }}>
        <header style={{ display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "16px 0 14px", borderBottom: `1px solid ${t.line}` }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
            <span style={{ fontWeight: 600 }}>riplo</span>
            <span style={{ color: t.inkFaint, fontFamily: mono, fontSize: 12, letterSpacing: ".06em" }}>ARENA</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12.5, color: t.inkSoft }}>
              <span style={{ width: 6, height: 6, borderRadius: 99, background: t.accent }} /> Blinded · randomised
            </span>
            <span style={{ fontSize: 12.5, color: t.inkFaint }}>
              <b style={{ color: t.ink, fontWeight: 600 }}>{count}</b> judged this session
            </span>
          </div>
        </header>

        <div className="panes" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 22,
          height: "82vh", minHeight: 560, padding: "20px 0 24px" }}>

          {/* ── LEFT: task context ── */}
          <div className="pane" style={{ display: "flex", flexDirection: "column", minHeight: 0,
            background: t.card, border: `1px solid ${t.line}`, borderRadius: 14, overflow: "hidden" }}>
            <div style={{ padding: "20px 22px 16px", borderBottom: `1px solid ${t.lineSoft}` }}>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
                <span style={{ fontFamily: mono, fontSize: 11.5, color: t.inkFaint, letterSpacing: ".05em" }}>TASK {battle.id}</span>
                <span style={{ fontFamily: mono, fontSize: 10.5, color: t.accent, background: t.accentSoft,
                  padding: "2px 8px", borderRadius: 99, textTransform: "uppercase", letterSpacing: ".04em" }}>{battle.kind}</span>
              </div>
              <h1 style={{ margin: 0, fontSize: 20, lineHeight: 1.25, letterSpacing: "-.015em", fontWeight: 600 }}>{battle.title}</h1>
              <p style={{ margin: "10px 0 0", color: t.inkSoft, fontSize: 13.5, lineHeight: 1.55 }}>{battle.guidance}</p>
            </div>

            <div style={{ padding: "14px 22px", borderBottom: `1px solid ${t.lineSoft}` }}>
              <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 10 }}>
                <span style={{ fontFamily: mono, fontSize: 10.5, color: t.inkFaint, letterSpacing: ".08em", textTransform: "uppercase" }}>What we're building</span>
                <span style={{ fontSize: 12, fontWeight: 600, color: t.accent }}>{battle.outputSpec.target}</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                {battle.outputSpec.parts.map((p, i) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 11px",
                    background: t.paper, border: `1px solid ${t.lineSoft}`, borderRadius: 9 }}>
                    {p.type === "bullets" ? <List size={14} color={t.inkSoft} /> : <FileText size={14} color={t.inkSoft} />}
                    <span style={{ fontSize: 13, fontWeight: 500 }}>{p.label}</span>
                    <span style={{ marginLeft: "auto", fontFamily: mono, fontSize: 10.5, color: t.inkFaint }}>{p.note}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{ padding: "14px 22px 6px" }}>
              <span style={{ fontFamily: mono, fontSize: 10.5, color: t.inkFaint, letterSpacing: ".08em", textTransform: "uppercase" }}>Source material</span>
            </div>
            <div className="scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "0 22px 22px" }}>
              {battle.source.map((b, i) => b.type === "bullets" ? (
                <ul key={i} style={{ margin: "10px 0 0", paddingLeft: 18, fontFamily: serif, fontSize: 14.5, lineHeight: 1.66, color: t.ink }}>
                  {b.items.map((it, j) => <li key={j} style={{ marginBottom: 4 }}>{it}</li>)}
                </ul>
              ) : (
                <p key={i} style={{ margin: i ? "12px 0 0" : 0, fontFamily: serif, fontSize: 14.5, lineHeight: 1.64, color: t.ink }}>{b.text}</p>
              ))}
            </div>
          </div>

          {/* ── RIGHT: options stacked + actions ── */}
          <div className="pane" style={{ display: "flex", flexDirection: "column", minHeight: 0 }}>
            {mode !== "rewriting" && (
              <>
                <div className="scroll" style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex",
                  flexDirection: "column", gap: 14, paddingRight: 2 }}>
                  {order.map((which) => (
                    <article key={which} className="opt" style={{ background: t.card, border: `1px solid ${t.line}`,
                      borderRadius: 14, padding: "16px 18px 18px" }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
                        <span style={{ fontFamily: mono, fontSize: 13, fontWeight: 600, border: `1px solid ${t.line}`,
                          borderRadius: 7, width: 26, height: 26, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>{which.toUpperCase()}</span>
                        <button onClick={() => startRewrite(which)}
                          style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12, fontWeight: 500,
                            color: t.rewrite, border: `1px solid ${t.rewriteSoft}`, background: "#FDFBF8", padding: "5px 10px", borderRadius: 8 }}>
                          <Pencil size={12.5} /> Rewrite this version
                        </button>
                      </div>
                      <p style={{ margin: 0, fontFamily: serif, fontSize: 15, lineHeight: 1.62, color: t.ink }}>{battle[which]}</p>
                    </article>
                  ))}
                </div>

                <div style={{ paddingTop: 14 }}>
                  {mode === "idle" && (
                    <>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10 }}>
                        <Vote label="A is better" hint="A" icon={<ArrowUp size={15} />}
                          hovered={hover === "a"} onEnter={() => setHover("a")} onLeave={() => setHover(null)} onClick={() => cast("A is better")} />
                        <Vote label="Tie" hint="T" subtle
                          hovered={hover === "t"} onEnter={() => setHover("t")} onLeave={() => setHover(null)} onClick={() => cast("Tie")} />
                        <Vote label="B is better" hint="B" icon={<ArrowDown size={15} />}
                          hovered={hover === "b"} onEnter={() => setHover("b")} onLeave={() => setHover(null)} onClick={() => cast("B is better")} />
                      </div>
                      <button onClick={() => setMode("choosing")}
                        onMouseEnter={() => setHover("r")} onMouseLeave={() => setHover(null)}
                        style={{ marginTop: 10, width: "100%", padding: 11, borderRadius: 10,
                          border: `1px dashed ${hover === "r" ? t.rewrite : t.line}`, color: hover === "r" ? t.rewrite : t.inkSoft,
                          fontSize: 13, fontWeight: 500, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
                          transition: "border-color .14s, color .14s" }}>
                        <PenLine size={14} /> Neither — rewrite <span className="kbd">R</span>
                      </button>
                      <div style={{ marginTop: 12, textAlign: "center", fontSize: 11.5, color: t.inkFaint }}>
                        <span className="kbd">A</span> · <span className="kbd">B</span> · <span className="kbd">T</span> tie · <span className="kbd">R</span> rewrite
                      </div>
                    </>
                  )}

                  {mode === "choosing" && (
                    <div className="reveal" style={{ border: `1px solid ${t.rewriteSoft}`, background: "#FDFBF8", borderRadius: 12, padding: 14 }}>
                      <div style={{ fontSize: 13, fontWeight: 600, color: t.rewrite, marginBottom: 10, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                        <span>Rewrite from…</span>
                        <button onClick={() => setMode("idle")} style={{ fontSize: 12, color: t.inkSoft, fontWeight: 500 }}>Cancel <span className="kbd">Esc</span></button>
                      </div>
                      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10 }}>
                        {[{ k: "a", l: "Version A", h: "A" }, { k: "b", l: "Version B", h: "B" }, { k: "scratch", l: "Scratch", h: "S" }].map((o) => (
                          <button key={o.k} onClick={() => startRewrite(o.k)}
                            style={{ padding: "12px 10px", borderRadius: 9, border: `1px solid ${t.line}`, background: t.card,
                              color: t.ink, fontSize: 13, fontWeight: 600, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7 }}>
                            {o.l} <span className="kbd">{o.h}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}

            {mode === "rewriting" && (
              <div className="reveal" style={{ flex: 1, minHeight: 0, display: "flex", flexDirection: "column",
                border: `1px solid ${t.rewriteSoft}`, background: "#FDFBF8", borderRadius: 14, padding: 18 }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <PenLine size={15} color={t.rewrite} />
                    <span style={{ fontWeight: 600, fontSize: 14, color: t.rewrite }}>
                      {base === "scratch" ? "Your version" : `Editing from ${base.toUpperCase()}`}
                    </span>
                  </div>
                  <button onClick={() => setMode("idle")} style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 12.5, color: t.inkSoft }}>
                    <ArrowLeft size={13} /> Back <span className="kbd">Esc</span></button>
                </div>
                <p style={{ margin: "0 0 12px", fontSize: 12, color: t.inkFaint }}>
                  {base === "scratch" ? "A blinded candidate in future battles."
                    : `Starting from ${base.toUpperCase()} records it as the closer of the two. Becomes a blinded candidate.`}
                </p>
                <textarea autoFocus value={draft} onChange={(e) => setDraft(e.target.value)}
                  style={{ flex: 1, minHeight: 0, width: "100%", resize: "none", padding: "14px 16px", fontFamily: serif,
                    fontSize: 15, lineHeight: 1.6, color: t.ink, background: t.card, border: `1px solid ${t.line}`, borderRadius: 10, outline: "none" }} />
                <div style={{ marginTop: 14, display: "flex", alignItems: "center", gap: 10 }}>
                  <button onClick={submitRewrite} disabled={!draft.trim()}
                    style={{ padding: "10px 18px", borderRadius: 9, background: draft.trim() ? t.rewrite : t.lineSoft,
                      color: draft.trim() ? "#fff" : t.inkFaint, fontWeight: 600, fontSize: 13.5, display: "inline-flex", alignItems: "center", gap: 8 }}>
                    Save & continue <CornerDownLeft size={14} />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {flash && (
        <div style={{ position: "fixed", bottom: 26, left: "50%", transform: "translateX(-50%)", background: t.ink,
          color: "#fff", padding: "11px 20px", borderRadius: 99, fontSize: 13.5, fontWeight: 500,
          display: "inline-flex", alignItems: "center", gap: 9, boxShadow: "0 8px 30px rgba(20,20,26,.22)" }}>
          <Check size={15} /> {flash.label}
        </div>
      )}
    </div>
  );
}

function Vote({ label, hint, onClick, icon, subtle, hovered, onEnter, onLeave }) {
  const a = hovered;
  const bg = subtle ? (a ? "#fff" : "transparent") : (a ? t.accent : t.card);
  const fg = subtle ? t.inkSoft : (a ? "#fff" : t.ink);
  const bd = subtle ? t.line : (a ? t.accent : t.line);
  return (
    <button onClick={onClick} onMouseEnter={onEnter} onMouseLeave={onLeave}
      style={{ padding: "13px 16px", borderRadius: 10, border: `1px solid ${bd}`, background: bg, color: fg,
        fontWeight: 600, fontSize: 14, display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 8,
        transition: "background .14s, color .14s, border-color .14s" }}>
      {icon}{label}
      <span className="kbd" style={{ color: a && !subtle ? "rgba(255,255,255,.7)" : t.inkFaint,
        borderColor: a && !subtle ? "rgba(255,255,255,.3)" : t.line }}>{hint}</span>
    </button>
  );
}
