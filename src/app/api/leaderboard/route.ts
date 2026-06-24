import { NextResponse } from 'next/server';
import { requireUser, requireRole, ForbiddenError } from '@/auth/workos';
import { getLeaderboard } from '@/services/ranking';
import type { ApiError } from '@/types/contracts';

export async function GET(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    const body: ApiError = { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } };
    return NextResponse.json(body, { status: 401 });
  }
  try {
    requireRole(user, 'admin');
  } catch (err) {
    if (err instanceof ForbiddenError) {
      const body: ApiError = { error: { code: 'FORBIDDEN', message: err.message } };
      return NextResponse.json(body, { status: 403 });
    }
    throw err;
  }

  const { searchParams } = new URL(request.url);
  const rankingRunId = searchParams.get('ranking_run_id') ?? undefined;

  try {
    const rows = await getLeaderboard(rankingRunId);
    return NextResponse.json(rows, { status: 200 });
  } catch (err) {
    console.error('Unexpected leaderboard error:', err);
    const body: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    return NextResponse.json(body, { status: 500 });
  }
}
