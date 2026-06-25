/**
 * Master output instruction appended to EVERY competitor's system prompt before
 * generation (see `renderRequest` in ./runner.ts).
 *
 * Purpose: normalize the *format* of outputs so the arena compares the substance
 * of each approach — not which competitor happens to add conversational "chrome"
 * (preambles like "Here's a draft", meta-commentary, sign-offs, follow-up offers).
 *
 * This is intentionally format-only. It must NOT contain any guidance that would
 * advantage one approach's *content* over another (structure, argumentation,
 * tone) — that is what the competitor prompts themselves are being tested on.
 *
 * Applies uniformly to all competitors, including vanilla (which otherwise sends
 * an empty system prompt).
 */
export const MASTER_OUTPUT_INSTRUCTION = `--- OUTPUT RULES (apply to every response; not part of the task) ---
- Produce only the requested deliverable. No preamble, framing, or meta-commentary about the work (e.g. "Here's a draft", "Note I've flagged...", "Let me know if...").
- Do not restate the task, announce what you are about to do, or describe your process.
- No sign-offs, follow-up questions, or offers to revise.
- Format the deliverable in clean Markdown.
- Begin directly with the substance of the answer.`;

/**
 * Composes a competitor's system prompt with the master output instruction.
 * The competitor prompt comes first; the master rules are appended last so they
 * are the most recent (and most reliably followed) framing the model reads.
 */
export function composeSystemPrompt(competitorSystem: string): string {
  const base = competitorSystem.trim();
  return base ? `${base}\n\n${MASTER_OUTPUT_INSTRUCTION}` : MASTER_OUTPUT_INSTRUCTION;
}
