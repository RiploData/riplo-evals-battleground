import { NextResponse } from 'next/server';
import { requireUser, ForbiddenError, UnauthorizedError } from '@/auth/workos';
import { createRankingRun } from '@/services/ranking';
import type { ApiError } from '@/types/contracts';

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    const body: ApiError = { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    return NextResponse.json(body, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    const err: ApiError = { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } };
    return NextResponse.json(err, { status: 400 });
  }

  const req = body as { campaign_id?: string; vote_cutoff_at?: string; filters?: unknown; seed?: number };

  if (!req.campaign_id) {
    const err: ApiError = { error: { code: 'BAD_REQUEST', message: 'campaign_id is required' } };
    return NextResponse.json(err, { status: 400 });
  }

  try {
    const result = await createRankingRun(user, {
      campaignId: req.campaign_id,
      voteCutoffAt: req.vote_cutoff_at,
      filters: req.filters,
      seed: req.seed,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ForbiddenError) {
      const body: ApiError = { error: { code: 'FORBIDDEN', message: err.message } };
      return NextResponse.json(body, { status: 403 });
    }
    if (err instanceof UnauthorizedError) {
      const body: ApiError = { error: { code: 'UNAUTHORIZED', message: err.message } };
      return NextResponse.json(body, { status: 401 });
    }
    console.error('Unexpected ranking run error:', err);
    const body: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    return NextResponse.json(body, { status: 500 });
  }
}
