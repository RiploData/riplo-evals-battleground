import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';

export type AppRole = 'member' | 'admin';

/**
 * Map a WorkOS org membership role slug to an AppRole.
 * Only 'admin' maps to admin; everything else (including undefined) maps to 'member'.
 */
function mapWorkosRole(slug: string | undefined | null): AppRole {
  return slug === 'admin' ? 'admin' : 'member';
}

export interface SessionUser {
  id: string;
  workosUserId: string;
  email: string;
  appRole: AppRole;
  orgId: string;
}

export class UnauthorizedError extends Error {
  constructor(message = 'Unauthorized') {
    super(message);
    this.name = 'UnauthorizedError';
  }
}

export class ForbiddenError extends Error {
  constructor(message = 'Forbidden') {
    super(message);
    this.name = 'ForbiddenError';
  }
}

/**
 * Atomic upsert keyed by workos_user_id — eliminates the SELECT-then-INSERT race window.
 * WorkOS is source of truth: on both insert and conflict the role is set to the mapped
 * WorkOS role so it is always synced from the session on every login.
 */
async function upsertUser(params: {
  workosUserId: string;
  email: string;
  orgId: string;
  role: AppRole;
}): Promise<SessionUser> {
  const [userRow] = await db
    .insert(users)
    .values({
      workosUserId: params.workosUserId,
      email: params.email,
      orgId: params.orgId,
      appRole: params.role,
    })
    .onConflictDoUpdate({
      target: users.workosUserId,
      set: {
        email: sql`excluded.email`,
        orgId: sql`excluded.org_id`,
        appRole: sql`excluded.app_role`,
      },
    })
    .returning();

  return {
    id: userRow.id,
    workosUserId: userRow.workosUserId,
    email: userRow.email,
    appRole: userRow.appRole as AppRole,
    orgId: userRow.orgId,
  };
}

export async function requireUser(): Promise<SessionUser> {
  // ── Local dev / e2e auth (NEVER active in production) ───────────────────────
  // Set ARENA_DEV_AUTH_EMAIL to click through the app or run the Playwright e2e
  // without an interactive WorkOS login. Real WorkOS is used whenever this is unset.
  if (process.env.NODE_ENV !== 'production' && process.env.ARENA_DEV_AUTH_EMAIL) {
    const email = process.env.ARENA_DEV_AUTH_EMAIL;
    const rawDevRole = process.env.ARENA_DEV_AUTH_ROLE;
    const role: AppRole = mapWorkosRole(rawDevRole === 'admin' ? 'admin' : rawDevRole ?? 'admin');
    return upsertUser({
      workosUserId: `dev-${email}`,
      email,
      orgId: process.env.ALLOWED_ORG_ID || 'dev-org',
      role,
    });
  }

  // Dynamic import so authkit's import-time WorkOS construction never runs on the
  // dev-auth path above (no WorkOS keys needed locally). vi.mock intercepts this too.
  const { withAuth } = await import('@workos-inc/authkit-nextjs');
  const session = await withAuth({ ensureSignedIn: true });

  if (!session.user) {
    throw new UnauthorizedError('No authenticated user');
  }

  const { user, organizationId, role } = session as typeof session & { role?: string };
  const allowedOrgId = process.env.ALLOWED_ORG_ID;

  if (!allowedOrgId || organizationId !== allowedOrgId) {
    throw new UnauthorizedError('Organization not allowed');
  }

  return upsertUser({
    workosUserId: user.id,
    email: user.email,
    orgId: organizationId,
    role: mapWorkosRole(role),
  });
}

export function requireRole(user: SessionUser, ...roles: AppRole[]): void {
  if (!roles.includes(user.appRole)) {
    throw new ForbiddenError(
      `Role '${user.appRole}' is not permitted. Required: ${roles.join(', ')}`
    );
  }
}
