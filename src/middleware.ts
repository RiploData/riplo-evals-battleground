import { NextResponse, type NextRequest } from 'next/server';

// In local dev / e2e the WorkOS middleware is bypassed so the app runs without
// WorkOS keys; requireUser() then resolves the dev user. The toggle is
// NEXT_PUBLIC_-prefixed because middleware runs in the edge runtime, which only
// sees inlined (public) env vars. authkit is imported DYNAMICALLY so its
// import-time WorkOS construction never runs on the dev-auth path (no keys needed).
const devAuth =
  process.env.NODE_ENV !== 'production' &&
  process.env.NEXT_PUBLIC_ARENA_DEV_AUTH === '1';

type Middleware = (req: NextRequest) => Response | Promise<Response>;
let realMiddleware: Middleware | null = null;

export default async function middleware(req: NextRequest): Promise<Response> {
  if (devAuth) {
    return NextResponse.next();
  }
  if (!realMiddleware) {
    const { authkitMiddleware } = await import('@workos-inc/authkit-nextjs');
    realMiddleware = authkitMiddleware() as unknown as Middleware;
  }
  return realMiddleware(req);
}

export const config = {
  // Match all routes except static files and Next.js internals
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
