import { eq, and } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  generationAttempts,
  responses,
  caseVersions,
  competitorVersions,
} from '@/db/schema';
import { contentHash } from '@/domain/content-hash';
import type { GenerationProvider, ProviderRequest } from './provider';
import { providerFor } from './providers';

/** Render typed source blocks (text/bullets) into a plain-text block for the prompt. */
function renderSourceBlocks(blocks: unknown): string {
  if (!Array.isArray(blocks)) return '';
  return blocks
    .map((b) => {
      const block = b as Record<string, unknown>;
      if (block.type === 'bullets' && Array.isArray(block.items)) {
        return block.items.map((it) => `- ${String(it)}`).join('\n');
      }
      if (typeof block.text === 'string') return block.text;
      return '';
    })
    .filter(Boolean)
    .join('\n\n');
}

/**
 * Renders a ProviderRequest from the case version (runner_input_json +
 * source_blocks_json) and the competitor version (prompt_bundle_json /
 * model_parameters_json).
 *
 * - system  ← prompt_bundle.system_prompt (the importer resolves system_prompt_ref
 *   into system_prompt); falls back to `system` for legacy/fixture shapes.
 * - user    ← assembled from runner_input.instruction + runner_input.constraints +
 *   the rendered source material. A direct runner_input.user string overrides.
 * - params  ← model_parameters_json, passed through.
 */
function renderRequest(
  runnerInput: Record<string, unknown>,
  sourceBlocks: unknown,
  promptBundle: Record<string, unknown>,
  modelParams: Record<string, unknown>,
  modelIdentifier: string,
): ProviderRequest {
  const system =
    (promptBundle['system_prompt'] as string | undefined) ??
    (promptBundle['system'] as string | undefined) ??
    '';

  let user: string;
  const directUser = runnerInput['user'];
  if (typeof directUser === 'string' && directUser.trim()) {
    user = directUser;
  } else {
    const parts: string[] = [];
    if (typeof runnerInput['instruction'] === 'string') parts.push(runnerInput['instruction']);
    if (typeof runnerInput['constraints'] === 'string') {
      parts.push(`Constraints:\n${runnerInput['constraints']}`);
    }
    const source = renderSourceBlocks(sourceBlocks);
    if (source) parts.push(`Source material:\n${source}`);
    user = parts.join('\n\n');
  }

  return {
    model: modelIdentifier,
    system,
    user,
    params: modelParams,
  };
}

/**
 * Ensures a response exists for the given (caseVersionId, competitorVersionId, replicateIndex) cell.
 *
 * - If a cached response already exists, returns its id without making a new attempt.
 * - Otherwise, inserts a generation_attempt (queued → running), calls the provider,
 *   writes an immutable content-hashed responses row on success, and marks the attempt succeeded.
 * - On provider error: marks the attempt failed with an error_code, writes NO response, and rethrows.
 */
export async function ensureResponse(
  caseVersionId: string,
  competitorVersionId: string,
  replicateIndex: number = 0,
  campaignId?: string,
  provider?: GenerationProvider,
): Promise<{ responseId: string }> {
  // --- Cache check ---
  const existing = await db
    .select({ id: responses.id })
    .from(responses)
    .where(
      and(
        eq(responses.caseVersionId, caseVersionId),
        eq(responses.competitorVersionId, competitorVersionId),
        eq(responses.replicateIndex, replicateIndex),
        eq(responses.originType, 'model_generation'),
      ),
    )
    .limit(1);

  if (existing.length > 0) {
    return { responseId: existing[0].id };
  }

  // --- Fetch case version and competitor version ---
  const [caseVersion] = await db
    .select({
      runnerInputJson: caseVersions.runnerInputJson,
      sourceBlocksJson: caseVersions.sourceBlocksJson,
    })
    .from(caseVersions)
    .where(eq(caseVersions.id, caseVersionId))
    .limit(1);

  if (!caseVersion) {
    throw new Error(`caseVersion not found: ${caseVersionId}`);
  }

  const [competitorVersion] = await db
    .select({
      modelIdentifier: competitorVersions.modelIdentifier,
      modelProvider: competitorVersions.modelProvider,
      promptBundleJson: competitorVersions.promptBundleJson,
      modelParametersJson: competitorVersions.modelParametersJson,
    })
    .from(competitorVersions)
    .where(eq(competitorVersions.id, competitorVersionId))
    .limit(1);

  if (!competitorVersion) {
    throw new Error(`competitorVersion not found: ${competitorVersionId}`);
  }

  if (!competitorVersion.modelIdentifier) {
    throw new Error(`Competitor version ${competitorVersionId} has no model_identifier`);
  }

  const activeProvider =
    provider ??
    (competitorVersion.modelProvider
      ? providerFor(competitorVersion.modelProvider)
      : (() => { throw new Error(`Competitor version ${competitorVersionId} has no model_provider`); })());

  const modelIdentifier = competitorVersion.modelIdentifier;
  const runnerInput = (caseVersion.runnerInputJson ?? {}) as Record<string, unknown>;
  const promptBundle = (competitorVersion.promptBundleJson ?? {}) as Record<string, unknown>;
  const modelParams = (competitorVersion.modelParametersJson ?? {}) as Record<string, unknown>;

  const request = renderRequest(
    runnerInput,
    caseVersion.sourceBlocksJson,
    promptBundle,
    modelParams,
    modelIdentifier,
  );

  if (!request.user.trim()) {
    throw new Error(
      `Empty rendered prompt for case ${caseVersionId} — check runner_input_json/source_blocks_json`,
    );
  }

  // --- Insert attempt (queued) ---
  const [attempt] = await db
    .insert(generationAttempts)
    .values({
      caseVersionId,
      competitorVersionId,
      replicateIndex,
      campaignId: campaignId ?? null,
      status: 'queued',
      renderedRequest: request as unknown as Record<string, unknown>,
    })
    .returning({ id: generationAttempts.id });

  const attemptId = attempt.id;

  // --- Mark running ---
  await db
    .update(generationAttempts)
    .set({ status: 'running', startedAt: new Date() })
    .where(eq(generationAttempts.id, attemptId));

  // --- Call provider ---
  const startedAt = Date.now();
  let result;
  try {
    result = await activeProvider.execute(request);
  } catch (err: unknown) {
    const latencyMs = Date.now() - startedAt;
    const errorCode =
      err instanceof Error ? err.message.slice(0, 128) : String(err).slice(0, 128);

    await db
      .update(generationAttempts)
      .set({
        status: 'failed',
        errorCode,
        latencyMs,
        completedAt: new Date(),
      })
      .where(eq(generationAttempts.id, attemptId));

    throw err;
  }

  const latencyMs = Date.now() - startedAt;

  // --- Write immutable response row ---
  const hash = contentHash(result.text);

  const [response] = await db
    .insert(responses)
    .values({
      caseVersionId,
      competitorVersionId,
      originType: 'model_generation',
      generationAttemptId: attemptId,
      bodyText: result.text,
      lengthChars: result.text.length,
      lengthTokens: result.outputTokens,
      contentHash: hash,
      replicateIndex,
      status: 'active',
    })
    .returning({ id: responses.id });

  // --- Mark attempt succeeded ---
  await db
    .update(generationAttempts)
    .set({
      status: 'succeeded',
      latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      finishReason: result.finishReason,
      providerRequestId: result.providerRequestId ?? null,
      modelReportedVersion: result.modelReportedVersion ?? null,
      completedAt: new Date(),
    })
    .where(eq(generationAttempts.id, attemptId));

  return { responseId: response.id };
}
