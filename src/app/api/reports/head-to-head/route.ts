import { NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { headToHead } from '@/services/reports';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    requireRole(user, 'admin');

    const { searchParams } = new URL(request.url);
    const rankingRunId = searchParams.get('rankingRunId') ?? undefined;

    const result = await headToHead(rankingRunId);
    return NextResponse.json(result);
  } catch (err: unknown) {
    if (err instanceof Error) {
      if (err.name === 'UnauthorizedError') {
        return NextResponse.json({ error: { code: 'unauthorized', message: err.message } }, { status: 401 });
      }
      if (err.name === 'ForbiddenError') {
        return NextResponse.json({ error: { code: 'forbidden', message: err.message } }, { status: 403 });
      }
    }
    console.error('[reports/head-to-head] error', err);
    return NextResponse.json({ error: { code: 'internal', message: 'Internal server error' } }, { status: 500 });
  }
}
