import { NextResponse } from 'next/server';
import { getLeaderboard } from '@/services/ranking';
import type { ApiError } from '@/types/contracts';

export async function GET(request: Request) {
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
