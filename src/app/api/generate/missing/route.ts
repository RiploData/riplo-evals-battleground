import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { enqueueMissingForCampaign } from '@/services/generate-batch';
import type { ApiError } from '@/types/contracts';

export const maxDuration = 60;

export async function POST(req: NextRequest): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch {
    const body: ApiError = { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    return NextResponse.json(body, { status: 401 });
  }

  try {
    requireRole(user, 'admin');
  } catch {
    const body: ApiError = { error: { code: 'FORBIDDEN', message: 'Insufficient role' } };
    return NextResponse.json(body, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    const err: ApiError = { error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' } };
    return NextResponse.json(err, { status: 400 });
  }

  const { campaign_id } = body as Record<string, unknown>;

  if (typeof campaign_id !== 'string') {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'campaign_id (string) is required' },
    };
    return NextResponse.json(err, { status: 400 });
  }

  try {
    const result = await enqueueMissingForCampaign(user, campaign_id);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error('Enqueue missing error:', err);
    const errBody: ApiError = {
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Internal server error',
      },
    };
    return NextResponse.json(errBody, { status: 500 });
  }
}
