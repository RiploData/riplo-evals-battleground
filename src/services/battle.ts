import { eq, and, inArray, isNull } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  campaigns,
  suiteVersions,
  caseVersions,
  cases,
  responses,
  comparisons,
  assignments,
} from '@/db/schema';
import { selectPair, pairKey } from '@/domain/matchmaking';
import { ensureResponse } from '@/services/generation/runner';
import { toBlindedOptions } from '@/domain/blinding';
import type { SessionUser } from '@/auth/workos';
import type { BattlePayload, BattleTask, OutputSpec, SourceBlock } from '@/types/contracts';
import type { GenerationProvider } from '@/services/generation/provider';

export interface GetNextBattleOpts {
  provider?: GenerationProvider;
  rng?: () => number;
}

/**
 * Loads the single active (default) campaign, picks an unseen pair for the user,
 * ensures responses exist for both cells, persists a comparison + assignment with
 * a randomly-chosen server-recorded left/right order, and returns a blinded payload.
 *
 * Returns null when every eligible pair has already been seen by this user.
 *
 * Injectable `provider` and `rng` make the function deterministic in tests.
 */
export async function getNextBattle(
  user: SessionUser,
  opts?: GetNextBattleOpts,
): Promise<BattlePayload | null> {
  const provider = opts?.provider;
  const rng = opts?.rng ?? Math.random;

  // 1. Load the single active campaign (most recently started, no end date).
  const activeCampaigns = await db
    .select()
    .from(campaigns)
    .where(isNull(campaigns.endedAt))
    .orderBy(campaigns.createdAt)
    .limit(1);

  if (activeCampaigns.length === 0) {
    return null;
  }

  const campaign = activeCampaigns[0];
  const eligibleCompetitorVersionIds = campaign.eligibleCompetitorVersionIds as string[];

  if (eligibleCompetitorVersionIds.length < 2) {
    return null;
  }

  // 2. Load eligible cases from the campaign's suite version.
  // campaign.suiteVersionId references suite_versions.id; resolve to the parent suiteId first.
  const [sv] = await db
    .select({ suiteId: suiteVersions.suiteId })
    .from(suiteVersions)
    .where(eq(suiteVersions.id, campaign.suiteVersionId))
    .limit(1);

  if (!sv) {
    return null;
  }

  const finalCaseVersions = await db
    .select({
      id: caseVersions.id,
      tags: caseVersions.tags,
      kind: caseVersions.kind,
      title: caseVersions.title,
      guidance: caseVersions.guidance,
      outputSpecJson: caseVersions.outputSpecJson,
      evaluatorContextJson: caseVersions.evaluatorContextJson,
      sourceBlocksJson: caseVersions.sourceBlocksJson,
      caseId: caseVersions.caseId,
    })
    .from(caseVersions)
    .innerJoin(cases, eq(cases.id, caseVersions.caseId))
    .where(eq(cases.suiteId, sv.suiteId));

  if (finalCaseVersions.length === 0) {
    return null;
  }

  // 3. Build existingPairCounts from comparisons.
  const existingComparisons = await db
    .select({
      responseOneId: comparisons.responseOneId,
      responseTwoId: comparisons.responseTwoId,
      caseVersionId: comparisons.caseVersionId,
    })
    .from(comparisons)
    .where(eq(comparisons.campaignId, campaign.id));

  // We need to map response ids back to competitor version ids.
  const allResponseIds = existingComparisons.flatMap(c => [c.responseOneId, c.responseTwoId]);

  const responseCompetitorMap: Record<string, string> = {};
  if (allResponseIds.length > 0) {
    const responseRows = await db
      .select({ id: responses.id, competitorVersionId: responses.competitorVersionId })
      .from(responses)
      .where(inArray(responses.id, allResponseIds));
    for (const row of responseRows) {
      if (row.competitorVersionId) {
        responseCompetitorMap[row.id] = row.competitorVersionId;
      }
    }
  }

  const existingPairCounts: Record<string, number> = {};
  for (const comp of existingComparisons) {
    const cvA = responseCompetitorMap[comp.responseOneId];
    const cvB = responseCompetitorMap[comp.responseTwoId];
    if (cvA && cvB && comp.caseVersionId) {
      const key = pairKey(comp.caseVersionId, cvA, cvB);
      existingPairCounts[key] = (existingPairCounts[key] ?? 0) + 1;
    }
  }

  // 4. Build seenByUser: pairs already assigned to this user.
  const userAssignments = await db
    .select({
      leftResponseId: assignments.leftResponseId,
      rightResponseId: assignments.rightResponseId,
    })
    .from(assignments)
    .where(eq(assignments.assignedUserId, user.id));

  const seenByUser = new Set<string>();
  if (userAssignments.length > 0) {
    const assignedResponseIds = userAssignments.flatMap(a => [a.leftResponseId, a.rightResponseId]);
    const assignedResponseRows = await db
      .select({
        id: responses.id,
        competitorVersionId: responses.competitorVersionId,
        caseVersionId: responses.caseVersionId,
      })
      .from(responses)
      .where(inArray(responses.id, assignedResponseIds));

    const respMap: Record<string, { competitorVersionId: string | null; caseVersionId: string }> = {};
    for (const row of assignedResponseRows) {
      respMap[row.id] = { competitorVersionId: row.competitorVersionId, caseVersionId: row.caseVersionId };
    }

    for (const assignment of userAssignments) {
      const left = respMap[assignment.leftResponseId];
      const right = respMap[assignment.rightResponseId];
      if (left?.competitorVersionId && right?.competitorVersionId && left.caseVersionId) {
        const key = pairKey(left.caseVersionId, left.competitorVersionId, right.competitorVersionId);
        seenByUser.add(key);
      }
    }
  }

  // 5. Select a pair.
  const pair = selectPair({
    cases: finalCaseVersions.map(cv => ({ caseVersionId: cv.id, tags: cv.tags as string[] })),
    eligibleCompetitorVersionIds,
    existingPairCounts,
    seenByUser,
    rng,
  });

  if (pair === null) {
    return null;
  }

  // 6. Ensure responses exist for both cells.
  const [respA, respB] = await Promise.all([
    ensureResponse(pair.caseVersionId, pair.competitorA, 0, campaign.id, provider),
    ensureResponse(pair.caseVersionId, pair.competitorB, 0, campaign.id, provider),
  ]);

  // 7. Fetch the response rows (for blinding).
  const [responseRowA, responseRowB] = await Promise.all([
    db.select().from(responses).where(eq(responses.id, respA.responseId)).limit(1),
    db.select().from(responses).where(eq(responses.id, respB.responseId)).limit(1),
  ]);

  if (!responseRowA[0] || !responseRowB[0]) {
    throw new Error('Response rows missing after ensureResponse');
  }

  // 8. Create a comparison row.
  const [comparison] = await db
    .insert(comparisons)
    .values({
      campaignId: campaign.id,
      caseVersionId: pair.caseVersionId,
      responseOneId: respA.responseId,
      responseTwoId: respB.responseId,
      matchmakingStrategy: 'coverage',
    })
    .returning({ id: comparisons.id });

  // 9. Randomly choose left/right order, server-recorded.
  const flip = rng() < 0.5;
  const leftResponse = flip ? responseRowB[0] : responseRowA[0];
  const rightResponse = flip ? responseRowA[0] : responseRowB[0];

  // 10. Create an assignment.
  const [assignment] = await db
    .insert(assignments)
    .values({
      comparisonId: comparison.id,
      assignedUserId: user.id,
      leftResponseId: leftResponse.id,
      rightResponseId: rightResponse.id,
      uiVersion: 'arena-1',
    })
    .returning({ id: assignments.id });

  // 11. Build the blinded payload.
  const options = toBlindedOptions(
    {
      id: leftResponse.id,
      body_text: leftResponse.bodyText,
      body_json: leftResponse.bodyJson ?? undefined,
    },
    {
      id: rightResponse.id,
      body_text: rightResponse.bodyText,
      body_json: rightResponse.bodyJson ?? undefined,
    },
  );

  // 12. Build the task from the case version's evaluator_context_json.
  const caseVersion = finalCaseVersions.find(cv => cv.id === pair.caseVersionId)!;
  const caseRow = await db
    .select({ externalRef: cases.externalRef })
    .from(cases)
    .where(eq(cases.id, caseVersion.caseId))
    .limit(1);

  const evalCtx = (caseVersion.evaluatorContextJson ?? {}) as Record<string, unknown>;
  const task: BattleTask = {
    case_external_ref: caseRow[0]?.externalRef ?? '',
    kind: caseVersion.kind,
    title: (evalCtx['title'] as string | undefined) ?? caseVersion.title,
    guidance: (evalCtx['guidance'] as string | undefined) ?? caseVersion.guidance ?? undefined,
    output_spec: (evalCtx['output_spec'] as OutputSpec | undefined) ?? (caseVersion.outputSpecJson as OutputSpec),
    source_blocks: (evalCtx['source_blocks'] as SourceBlock[] | undefined) ?? (caseVersion.sourceBlocksJson as SourceBlock[]) ?? [],
  };

  return {
    assignment_id: assignment.id,
    ui_version: 'arena-1',
    task,
    options,
  };
}
