import { NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { positionBias } from '@/services/reports';

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const user = await requireUser();
    requireRole(user, 'admin');

    const { searchParams } = new URL(request.url);
    const campaignId = searchParams.get('campaignId');

    if (!campaignId) {
      return NextResponse.json(
        { error: { code: 'bad_request', message: "Query param 'campaignId' is required" } },
        { status: 400 },
      );
    }

    const result = await positionBias(campaignId);
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
    console.error('[reports/position-bias] error', err);
    return NextResponse.json({ error: { code: 'internal', message: 'Internal server error' } }, { status: 500 });
  }
}
