import 'dotenv/config';
import { eq, and } from 'drizzle-orm';
import { db, pool } from '@/db/client';
import { campaigns, caseVersions, responses } from '@/db/schema';
import { ensureResponse } from '@/services/generation/runner';
import type { GenerationProvider, ProviderResult } from '@/services/generation/provider';

/**
 * DEV / DEMO ONLY — generates placeholder responses for every (case × competitor)
 * cell of the default campaign using a deterministic FAKE provider, so the battle
 * loop is clickable locally WITHOUT an ANTHROPIC_API_KEY or OPENAI_API_KEY.
 *
 * The real app generates live responses via configured providers on demand whenever a key is
 * configured; this script does not touch that path. Run it only to demo/e2e locally.
 *
 *   npx tsx scripts/seed-dev-responses.ts
 */

function fakeProvider(): GenerationProvider {
  let n = 0;
  return {
    async execute(req): Promise<ProviderResult> {
      n += 1;
      // Deterministic, visibly-different bodies so battles are distinguishable.
      const flavour = req.model.includes('opus') ? 'sharp & compressed' : 'thorough & detailed';
      const text =
        `[${flavour}] ${req.user.slice(0, 80)}\n\n` +
        `This is a placeholder response #${n} for local demo. ` +
        `It stands in for a live model output until ANTHROPIC_API_KEY or OPENAI_API_KEY is set.`;
      return {
        text,
        inputTokens: 100,
        outputTokens: 60 + (n % 7),
        finishReason: 'stop',
        providerRequestId: `dev-fake-${n}`,
        modelReportedVersion: undefined,
        raw: {},
      };
    },
  };
}

async function main() {
  const [campaign] = await db.select().from(campaigns).limit(1);
  if (!campaign) {
    console.error('No campaign found. Run `npm run seed` first.');
    process.exit(1);
  }
  const competitorVersionIds = (campaign.eligibleCompetitorVersionIds ?? []) as string[];
  if (competitorVersionIds.length === 0) {
    console.error('Campaign has no eligible competitor versions. Run `npm run seed` first.');
    process.exit(1);
  }

  const cvs = await db
    .select({ id: caseVersions.id })
    .from(caseVersions);

  const provider = fakeProvider();
  let created = 0;
  let cached = 0;
  for (const cv of cvs) {
    for (const compVid of competitorVersionIds) {
      const before = await db
        .select({ id: responses.id })
        .from(responses)
        .where(
          and(
            eq(responses.caseVersionId, cv.id),
            eq(responses.competitorVersionId, compVid),
            eq(responses.originType, 'model_generation'),
          ),
        )
        .limit(1);
      await ensureResponse(cv.id, compVid, 0, campaign.id, provider);
      if (before.length > 0) cached += 1;
      else created += 1;
    }
  }

  console.log(`Dev responses ready: ${created} created, ${cached} already present.`);
  console.log(`Cells: ${cvs.length} cases × ${competitorVersionIds.length} competitors.`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
