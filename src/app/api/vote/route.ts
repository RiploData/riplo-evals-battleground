import { NextResponse } from 'next/server';
import { requireUser } from '@/auth/workos';
import { submitVote, VoteError } from '@/services/vote';
import type { VoteRequest, ApiError } from '@/types/contracts';

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

  const req = body as VoteRequest;

  if (!req.assignment_id) {
    const err: ApiError = { error: { code: 'BAD_REQUEST', message: 'assignment_id is required' } };
    return NextResponse.json(err, { status: 400 });
  }

  try {
    const result = await submitVote(user, req);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof VoteError) {
      const body: ApiError = { error: { code: err.code, message: err.message } };
      return NextResponse.json(body, { status: err.status });
    }
    console.error('Unexpected vote error:', err);
    const body: ApiError = { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } };
    return NextResponse.json(body, { status: 500 });
  }
}
