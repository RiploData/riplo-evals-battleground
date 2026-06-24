import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireRole, UnauthorizedError, ForbiddenError } from '@/auth/workos';
import { enqueueGeneration } from '@/services/generate-batch';
import type { ApiError } from '@/types/contracts';

export async function POST(req: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    const code = (err as Error).name === 'UnauthorizedError' ? 401 : 403;
    const body: ApiError = {
      error: {
        code: code === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
        message: (err as Error).message,
      },
    };
    return NextResponse.json(body, { status: code });
  }

  try {
    requireRole(user, 'operator', 'admin');
  } catch (err) {
    if (err instanceof ForbiddenError) {
      const body: ApiError = {
        error: { code: 'FORBIDDEN', message: err.message },
      };
      return NextResponse.json(body, { status: 403 });
    }
    throw err;
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const errBody: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' },
    };
    return NextResponse.json(errBody, { status: 400 });
  }

  const parsed = body as Record<string, unknown>;
  const { campaignId, caseVersionIds, competitorVersionIds, replicates } = parsed;

  if (
    typeof campaignId !== 'string' ||
    !Array.isArray(caseVersionIds) ||
    !Array.isArray(competitorVersionIds)
  ) {
    const errBody: ApiError = {
      error: {
        code: 'BAD_REQUEST',
        message: 'campaignId (string), caseVersionIds (array), competitorVersionIds (array) are required',
      },
    };
    return NextResponse.json(errBody, { status: 400 });
  }

  try {
    const result = await enqueueGeneration(user, {
      campaignId,
      caseVersionIds: caseVersionIds as string[],
      competitorVersionIds: competitorVersionIds as string[],
      replicates: typeof replicates === 'number' ? replicates : undefined,
    });
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    const errBody: ApiError = {
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
    };
    return NextResponse.json(errBody, { status: 500 });
  }
}
