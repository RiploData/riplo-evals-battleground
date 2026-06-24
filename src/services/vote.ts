import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { assignments, comparisons, responses, judgments } from '@/db/schema';
import { resolvePreferredResponse, effectiveOutcome } from '@/domain/outcomes';
import { contentHash } from '@/domain/content-hash';
import type { SessionUser } from '@/auth/workos';
import type { VoteRequest, VoteResponse } from '@/types/contracts';

export class VoteError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'VoteError';
  }
}

export async function submitVote(user: SessionUser, req: VoteRequest): Promise<VoteResponse> {
  // 1. Load assignment and validate ownership + status
  const [assignment] = await db
    .select()
    .from(assignments)
    .where(eq(assignments.id, req.assignment_id))
    .limit(1);

  if (!assignment) {
    throw new VoteError('Assignment not found', 'ASSIGNMENT_NOT_FOUND', 404);
  }
  if (assignment.assignedUserId !== user.id) {
    throw new VoteError('Assignment does not belong to user', 'ASSIGNMENT_NOT_YOURS', 403);
  }
  if (assignment.status !== 'open') {
    throw new VoteError('Assignment is not open', 'ASSIGNMENT_NOT_OPEN', 409);
  }

  // 2. Compute effective outcome (rewrite-only defaults to 'both_unacceptable')
  const hasRewrite = req.rewrite !== undefined;
  const outcome = effectiveOutcome(req.outcome, hasRewrite);

  // 3. If rewrite present, create a post_battle_rewrite response (NEVER mutate originals)
  let rewriteResponseId: string | undefined;
  let rewriteForkedFrom: string | undefined;

  if (req.rewrite) {
    const { forked_from, body_text } = req.rewrite;
    rewriteForkedFrom = forked_from;

    // Determine parent_response_ids from forked side:
    // 'a' → left response, 'b' → right response, 'scratch' → no parents
    let parentResponseIds: string[] | null = null;
    if (forked_from === 'a') {
      parentResponseIds = [assignment.leftResponseId];
    } else if (forked_from === 'b') {
      parentResponseIds = [assignment.rightResponseId];
    }
    // 'scratch' → parentResponseIds stays null

    // We need the caseVersionId from the comparison
    const [comparison] = await db
      .select()
      .from(comparisons)
      .where(eq(comparisons.id, assignment.comparisonId))
      .limit(1);

    if (!comparison) {
      throw new VoteError('Comparison not found', 'COMPARISON_NOT_FOUND', 500);
    }

    const hash = contentHash({ body_text, author_user_id: user.id, forked_from });

    const [rewriteRow] = await db
      .insert(responses)
      .values({
        caseVersionId: comparison.caseVersionId,
        originType: 'post_battle_rewrite',
        authorUserId: user.id,
        bodyText: body_text,
        lengthChars: body_text.length,
        parentResponseIds: parentResponseIds ?? undefined,
        contentHash: hash,
      })
      .returning({ id: responses.id });

    rewriteResponseId = rewriteRow.id;
  }

  // 4. Resolve preferred_response_id using assignment's recorded left/right order
  const preferredResponseId = resolvePreferredResponse(
    outcome,
    assignment.leftResponseId,
    assignment.rightResponseId,
  );

  // 5. Insert append-only judgment and mark assignment submitted (in sequence)
  const [judgment] = await db
    .insert(judgments)
    .values({
      assignmentId: req.assignment_id,
      userId: user.id,
      outcome,
      preferredResponseId: preferredResponseId ?? undefined,
      reasonTags: req.reason_tags ?? [],
      freeTextComment: req.free_text_comment,
      timeToFirstActionMs: req.time_to_first_action_ms,
      totalDurationMs: req.total_duration_ms,
      rewriteResponseId,
      rewriteForkedFrom,
      status: 'valid',
    })
    .returning({ id: judgments.id });

  await db
    .update(assignments)
    .set({ status: 'submitted', submittedAt: new Date() })
    .where(eq(assignments.id, req.assignment_id));

  // 6. Return judgment_id and next route
  return { judgment_id: judgment.id, next: '/battle' };
}
