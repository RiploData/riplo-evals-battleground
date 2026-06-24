import { NextResponse } from 'next/server';
import { requireUser, requireRole } from '@/auth/workos';
import { exportJudgments } from '@/services/export';

export async function GET(request: Request) {
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
    requireRole(user, 'analyst', 'operator', 'admin');
  } catch {
    return NextResponse.json(
      { error: { code: 'FORBIDDEN', message: 'Insufficient role' } },
      { status: 403 },
    );
  }

  const { searchParams } = new URL(request.url);
  const campaignId = searchParams.get('campaign_id');
  const format = searchParams.get('format') ?? 'json';

  if (!campaignId) {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'campaign_id is required' } },
      { status: 400 },
    );
  }

  if (format !== 'csv' && format !== 'json') {
    return NextResponse.json(
      { error: { code: 'BAD_REQUEST', message: 'format must be csv or json' } },
      { status: 400 },
    );
  }

  try {
    const data = await exportJudgments(campaignId, format);

    if (format === 'csv') {
      return new Response(data, {
        status: 200,
        headers: {
          'Content-Type': 'text/csv',
          'Content-Disposition': `attachment; filename="judgments-${campaignId}.csv"`,
        },
      });
    }

    return new Response(data, {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (err) {
    console.error('Export judgments error:', err);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } },
      { status: 500 },
    );
  }
}
