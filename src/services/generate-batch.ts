import { eq, and } from 'drizzle-orm';
import { db } from '@/db/client';
import { generationAttempts, responses } from '@/db/schema';
import { ensureResponse } from '@/services/generation/runner';
import type { SessionUser } from '@/auth/workos';
import type { GenerationProvider } from '@/services/generation/provider';

export interface EnqueueBody {
  campaignId: string;
  caseVersionIds: string[];
  competitorVersionIds: string[];
  replicates?: number;
}

export interface EnqueueResult {
  enqueued: number;
  completed: number;
}

/**
 * Synchronously calls ensureResponse for each (caseVersionId × competitorVersionId × replicateIndex)
 * cell. Cells already cached are no-ops; the queued-row contract is upheld inside ensureResponse.
 *
 * Returns `enqueued` (total cells attempted) and `completed` (responses that now exist, including
 * those that were already cached before this call).
 */
export async function enqueueGeneration(
  _user: SessionUser,
  body: EnqueueBody,
  provider?: GenerationProvider,
): Promise<EnqueueResult> {
  const { campaignId, caseVersionIds, competitorVersionIds, replicates = 1 } = body;

  let enqueued = 0;
  let completed = 0;

  for (const caseVersionId of caseVersionIds) {
    for (const competitorVersionId of competitorVersionIds) {
      for (let replicateIndex = 0; replicateIndex < replicates; replicateIndex++) {
        enqueued++;
        try {
          await ensureResponse(
            caseVersionId,
            competitorVersionId,
            replicateIndex,
            campaignId,
            provider,
          );
          completed++;
        } catch {
          // Provider failure — cell was attempted but not completed; continue with remaining cells
        }
      }
    }
  }

  return { enqueued, completed };
}

/**
 * Returns counts of generation_attempts grouped by status for the given campaign.
 */
export async function generationStatus(campaignId: string): Promise<Record<string, number>> {
  const rows = await db
    .select({
      status: generationAttempts.status,
    })
    .from(generationAttempts)
    .where(eq(generationAttempts.campaignId, campaignId));

  const counts: Record<string, number> = {};
  for (const row of rows) {
    counts[row.status] = (counts[row.status] ?? 0) + 1;
  }
  return counts;
}
