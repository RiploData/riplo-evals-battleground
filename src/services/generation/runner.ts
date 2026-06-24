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

/**
 * Renders a ProviderRequest from the case version's runner_input_json and
 * the competitor version's prompt_bundle_json / model_parameters_json.
 *
 * runner_input_json is expected to contain at least { user: string }.
 * prompt_bundle_json is expected to contain at least { system: string }.
 * model_parameters_json is passed through as params.
 */
function renderRequest(
  runnerInput: Record<string, unknown>,
  promptBundle: Record<string, unknown>,
  modelParams: Record<string, unknown>,
  modelIdentifier: string,
): ProviderRequest {
  const system = (promptBundle['system'] as string | undefined) ?? '';
  const user = (runnerInput['user'] as string | undefined) ?? '';
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

  if (!competitorVersion.modelProvider) {
    throw new Error(`Competitor version ${competitorVersionId} has no model_provider`);
  }

  const activeProvider = provider ?? providerFor(competitorVersion.modelProvider);

  const modelIdentifier = competitorVersion.modelIdentifier;
  const runnerInput = (caseVersion.runnerInputJson ?? {}) as Record<string, unknown>;
  const promptBundle = (competitorVersion.promptBundleJson ?? {}) as Record<string, unknown>;
  const modelParams = (competitorVersion.modelParametersJson ?? {}) as Record<string, unknown>;

  const request = renderRequest(runnerInput, promptBundle, modelParams, modelIdentifier);

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
