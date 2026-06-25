import { NextRequest, NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { setCaseEligibility } from '@/services/admin';
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

  const { case_id, override } = body as Record<string, unknown>;

  if (typeof case_id !== 'string') {
    const err: ApiError = { error: { code: 'BAD_REQUEST', message: 'case_id (string) is required' } };
    return NextResponse.json(err, { status: 400 });
  }

  if (override !== null && override !== true && override !== false) {
    const err: ApiError = {
      error: { code: 'BAD_REQUEST', message: 'override must be true, false, or null' },
    };
    return NextResponse.json(err, { status: 400 });
  }

  try {
    await setCaseEligibility(case_id, override as boolean | null);
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    console.error('Set case eligibility error:', err);
    const errBody: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    return NextResponse.json(errBody, { status: 500 });
  }
}
