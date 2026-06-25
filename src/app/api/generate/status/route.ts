import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireRole, ForbiddenError } from '@/auth/workos';
import { campaignCellState } from '@/services/generate-batch';
import type { ApiError } from '@/types/contracts';

export async function GET(req: NextRequest): Promise<NextResponse> {
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
    requireRole(user, 'admin');
  } catch (err) {
    if (err instanceof ForbiddenError) {
      const body: ApiError = {
        error: { code: 'FORBIDDEN', message: err.message },
      };
      return NextResponse.json(body, { status: 403 });
    }
    throw err;
  }

  const { searchParams } = new URL(req.url);
  const campaignId = searchParams.get('campaignId');

  if (!campaignId) {
    const errBody: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'campaignId query parameter is required' },
    };
    return NextResponse.json(errBody, { status: 400 });
  }

  try {
    const state = await campaignCellState(campaignId);
    return NextResponse.json(state, { status: 200 });
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
