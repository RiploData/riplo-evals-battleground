/**
 * scripts/skills-dryrun.ts
 *
 * Probes whether the configured API keys are allowed to run the provider-hosted
 * skill/agent loops we depend on — WITHOUT creating any persistent resources:
 *
 *   Anthropic  • code-execution beta (the sandbox the skill runs in)
 *              • skills beta (skills.list — confirms Skills API access)
 *   OpenAI     • code-interpreter auto container via the Responses API
 *
 * Each probe runs the real models the skillful competitors use. Read-only-ish:
 * the Anthropic code-exec probe runs a trivial calculation in an ephemeral sandbox;
 * nothing is uploaded or persisted. Exit code is non-zero if any probe fails.
 *
 * Usage:
 *   npm run skills:dryrun
 *   npm run skills:dryrun -- --anthropic-model claude-opus-4-8 --openai-model gpt-5.5
 */

import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';

function argval(flag: string, fallback: string): string {
  const i = process.argv.indexOf(flag);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}

const ANTHROPIC_MODEL = argval('--anthropic-model', 'claude-opus-4-8');
const OPENAI_MODEL = argval('--openai-model', 'gpt-5.5');

interface ProbeResult {
  name: string;
  ok: boolean;
  detail: string;
}

async function probeAnthropicCodeExec(): Promise<ProbeResult> {
  const name = `Anthropic code-execution (${ANTHROPIC_MODEL})`;
  if (!process.env.ANTHROPIC_API_KEY) return { name, ok: false, detail: 'ANTHROPIC_API_KEY not set' };
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const resp = await client.beta.messages.create({
      model: ANTHROPIC_MODEL,
      max_tokens: 1024,
      betas: ['code-execution-2025-08-25'],
      tools: [{ type: 'code_execution_20250825', name: 'code_execution' }],
      messages: [
        { role: 'user', content: 'Use the code execution tool to compute 6 * 7, then state the result.' },
      ],
    });
    const ranCode = resp.content.some((b) => b.type.startsWith('bash_code_execution') || b.type === 'server_tool_use');
    return { name, ok: true, detail: `stop_reason=${resp.stop_reason}, ranCode=${ranCode}` };
  } catch (err: unknown) {
    return { name, ok: false, detail: (err as Error)?.message ?? String(err) };
  }
}

async function probeAnthropicSkillsApi(): Promise<ProbeResult> {
  const name = 'Anthropic Skills API (skills.list)';
  if (!process.env.ANTHROPIC_API_KEY) return { name, ok: false, detail: 'ANTHROPIC_API_KEY not set' };
  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const page = await client.beta.skills.list({ betas: ['skills-2025-10-02'] });
    return { name, ok: true, detail: `accessible (${page.data.length} skill(s) visible on first page)` };
  } catch (err: unknown) {
    return { name, ok: false, detail: (err as Error)?.message ?? String(err) };
  }
}

async function probeOpenAICodeInterpreter(): Promise<ProbeResult> {
  const name = `OpenAI code-interpreter auto container (${OPENAI_MODEL})`;
  if (!process.env.OPENAI_API_KEY) return { name, ok: false, detail: 'OPENAI_API_KEY not set' };
  try {
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const resp = await client.responses.create({
      model: OPENAI_MODEL,
      input: 'Use the code interpreter to compute 6 * 7, then state the result.',
      tools: [{ type: 'code_interpreter', container: { type: 'auto' } }],
    });
    return { name, ok: true, detail: `status=${resp.status}, output_text=${JSON.stringify((resp.output_text ?? '').slice(0, 40))}` };
  } catch (err: unknown) {
    return { name, ok: false, detail: (err as Error)?.message ?? String(err) };
  }
}

async function main() {
  console.log('=== Skill dry-run: provider capability probes ===\n');
  const results = await Promise.all([
    probeAnthropicCodeExec(),
    probeAnthropicSkillsApi(),
    probeOpenAICodeInterpreter(),
  ]);

  for (const r of results) {
    console.log(`${r.ok ? '✅' : '❌'}  ${r.name}\n     ${r.detail}\n`);
  }

  const failed = results.filter((r) => !r.ok);
  if (failed.length) {
    console.log(`${failed.length} probe(s) failed. The keys/account cannot yet run the skill path above.`);
    process.exit(1);
  }
  console.log('All probes passed — the keys allow the provider-hosted skill loops.');
}

main().catch((err) => {
  console.error('dry-run crashed:', err?.message ?? err);
  process.exit(1);
});
