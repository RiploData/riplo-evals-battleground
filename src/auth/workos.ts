import { withAuth } from '@workos-inc/authkit-nextjs';
import { sql } from 'drizzle-orm';
import { db } from '@/db/client';
import { users } from '@/db/schema';

export type AppRole = 'evaluator' | 'suite_editor' | 'operator' | 'analyst' | 'admin';

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

export async function requireUser(): Promise<SessionUser> {
  const session = await withAuth({ ensureSignedIn: true });

  if (!session.user) {
    throw new UnauthorizedError('No authenticated user');
  }

  const { user, organizationId } = session;
  const allowedOrgId = process.env.ALLOWED_ORG_ID;

  if (!allowedOrgId || organizationId !== allowedOrgId) {
    throw new UnauthorizedError('Organization not allowed');
  }

  // Atomic upsert keyed by workos_user_id — eliminates SELECT-then-INSERT race window
  const [userRow] = await db
    .insert(users)
    .values({
      workosUserId: user.id,
      email: user.email,
      orgId: organizationId,
      appRole: 'evaluator',
    })
    .onConflictDoUpdate({
      target: users.workosUserId,
      set: {
        email: sql`excluded.email`,
        orgId: sql`excluded.org_id`,
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

export function requireRole(user: SessionUser, ...roles: AppRole[]): void {
  if (!roles.includes(user.appRole)) {
    throw new ForbiddenError(
      `Role '${user.appRole}' is not permitted. Required: ${roles.join(', ')}`
    );
  }
}
