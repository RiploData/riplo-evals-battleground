import { NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { segments } from '@/services/reports';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    requireRole(user, 'analyst', 'operator', 'admin');

    const { searchParams } = new URL(request.url);
    const rankingRunId = searchParams.get('rankingRunId') ?? undefined;
    const by = searchParams.get('by') as 'tag' | 'kind' | 'difficulty' | null;

    if (!by || !['tag', 'kind', 'difficulty'].includes(by)) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: "Query param 'by' must be 'tag', 'kind', or 'difficulty'" } },
        { status: 400 },
      );
    }

    const result = await segments(rankingRunId, by);
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
    console.error('[reports/segments] error', err);
    return NextResponse.json({ error: { code: 'internal', message: 'Internal server error' } }, { status: 500 });
  }
}
