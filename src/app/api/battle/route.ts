import { NextResponse } from 'next/server';
import { requireUser } from '@/auth/workos';
import { getNextBattle } from '@/services/battle';
import type { ApiError } from '@/types/contracts';

// Lazily generates missing responses via the model provider, which can be slow.
export const maxDuration = 300;

export async function GET(): Promise<NextResponse> {
  let user;
  try {
    user = await requireUser();
  } catch (err) {
    const code = (err as Error).name === 'UnauthorizedError' ? 401 : 403;
    const body: ApiError = {
      error: {
        code: code === 401 ? 'UNAUTHORIZED' : 'FORBIDDEN',
        message: (err as Error).message,
      },
    };
    return NextResponse.json(body, { status: code });
  }

  try {
    const payload = await getNextBattle(user);

    if (payload === null) {
      return new NextResponse(null, { status: 204 });
    }

    return NextResponse.json(payload, { status: 200 });
  } catch (err) {
    const body: ApiError = {
      error: {
        code: 'INTERNAL_ERROR',
        message: err instanceof Error ? err.message : 'Unknown error',
      },
    };
    return NextResponse.json(body, { status: 500 });
  }
}
