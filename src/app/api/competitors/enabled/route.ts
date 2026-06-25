import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { setCompetitorEnabled } from '@/services/admin';
import type { ApiError } from '@/types/contracts';

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

  const { competitor_id, enabled } = body as Record<string, unknown>;

  if (typeof competitor_id !== 'string') {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'competitor_id (string) is required' },
    };
    return NextResponse.json(err, { status: 400 });
  }

  if (typeof enabled !== 'boolean') {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'enabled (boolean) is required' },
    };
    return NextResponse.json(err, { status: 400 });
  }

  try {
    await setCompetitorEnabled(competitor_id, enabled);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Set competitor enabled error:', err);
    const errBody: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    return NextResponse.json(errBody, { status: 500 });
  }
}
