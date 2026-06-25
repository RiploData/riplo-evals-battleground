/**
 * scripts/generate.ts
 *
 * Headless, run-to-completion generation for a campaign — the offline equivalent
 * of the admin "Generate all missing (eligible)" button. Loops
 * enqueueMissingForCampaign until nothing is left (or it stalls), making real
 * provider calls with the keys in the environment. Honors whatever DATABASE_URL
 * points at, so it's how you seed answers into the remote DB from your laptop.
 *
 * Usage:
 *   npm run generate                                  # campaign named in config/campaign.json
 *   npm run generate -- --campaign-id <uuid>          # explicit campaign
 *   DATABASE_URL=<rds> npm run generate               # generate into the remote DB
 */

import 'dotenv/config';
import fs from 'node:fs/promises';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { campaigns } from '@/db/schema';
import { enqueueMissingForCampaign } from '@/services/generate-batch';
import type { SessionUser } from '@/auth/workos';

const SYSTEM_USER = { id: 'cli', email: 'cli@local', appRole: 'admin' } as unknown as SessionUser;
const MAX_ROUNDS = 200;

function argval(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i !== -1 ? process.argv[i + 1] : undefined;
}

async function resolveCampaignId(): Promise<string> {
  const explicit = argval('--campaign-id');
  if (explicit) return explicit;
  const cfg = JSON.parse(
    await fs.readFile(path.join(process.cwd(), 'config', 'campaign.json'), 'utf-8'),
  ) as { name: string };
  const [row] = await db.select({ id: campaigns.id }).from(campaigns).where(eq(campaigns.name, cfg.name)).limit(1);
  if (!row) throw new Error(`Campaign "${cfg.name}" not found — run \`npm run seed\` first.`);
  return row.id;
}

async function main() {
  const campaignId = await resolveCampaignId();
  console.log('=== Generate (run to completion) ===');
  console.log(`campaign: ${campaignId}`);

  let lastRemaining = Infinity;
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    const r = await enqueueMissingForCampaign(SYSTEM_USER, campaignId, undefined, {
      deadlineMs: 9 * 60_000, // generous per-round budget for slow skill loops
      concurrency: 4,
    });
    console.log(
      `round ${round}: generated ${r.generated}, skipped ${r.skipped}, failed ${r.failed}, ` +
        `remaining ${r.remaining}/${r.total}`,
    );

    if (r.remaining === 0) {
      console.log('\n✅ Done — all eligible cells have responses.');
      return;
    }
    if (r.generated === 0 || r.remaining >= lastRemaining) {
      console.log(
        `\n⚠️  Stalled — ${r.remaining} cell(s) still missing` +
          (r.failed > 0 ? ` (${r.failed} failed this round — check keys / provider capacity, then re-run).` : '.'),
      );
      return;
    }
    lastRemaining = r.remaining;
  }
  console.log(`\n⚠️  Hit round cap (${MAX_ROUNDS}) with work remaining — re-run to continue.`);
}

main()
  .then(() => pool.end())
  .catch((err) => {
    console.error('generate failed:', err?.message ?? err);
    void pool.end();
    process.exit(1);
  });
