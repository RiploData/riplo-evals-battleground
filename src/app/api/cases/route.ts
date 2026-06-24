import { NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { listCases } from '@/services/export';

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Authentication required' } },
      { status: 401 },
    );
  }

  try {
    requireRole(user, 'admin');
  } catch {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient role' } },
      { status: 403 },
    );
  }

  try {
    const data = await listCases();
    return NextResponse.json(data, { status: 200 });
  } catch (err) {
    console.error('List cases error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
