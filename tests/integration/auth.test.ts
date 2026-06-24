import { describe, it, expect, vi, afterAll } from 'vitest';
import 'dotenv/config';
import { eq } from 'drizzle-orm';

// Set the env vars BEFORE anything else imports them
process.env.ALLOWED_ORG_ID = 'org_allowed_test_99999';

// Mock the WorkOS authkit module BEFORE importing requireUser
vi.mock('@workos-inc/authkit-nextjs', () => ({
  withAuth: vi.fn(),
  authkitMiddleware: vi.fn(() => vi.fn()),
  handleAuth: vi.fn(() => vi.fn()),
}));

import { withAuth } from '@workos-inc/authkit-nextjs';
import {
  requireUser,
  requireRole,
  UnauthorizedError,
  ForbiddenError,
  type SessionUser,
} from '@/auth/workos';
import { db } from '@/db/client';
import { users } from '@/db/schema';

// Test WorkOS user IDs — unique enough to not collide with real data
const TEST_USER_ALLOWED_ID = 'workos_test_allowed_user_99999';
const ALLOWED_ORG = 'org_allowed_test_99999';
const OTHER_ORG = 'org_other_test_99999';

const mockWithAuth = withAuth as ReturnType<typeof vi.fn>;

afterAll(async () => {
  // Clean up test rows by workos_user_id — only our test rows, not the whole table
  await db.delete(users).where(eq(users.workosUserId, TEST_USER_ALLOWED_ID));
});

describe('requireUser', () => {
  it('(a) upserts a users row and returns SessionUser for a user in ALLOWED_ORG_ID', async () => {
    mockWithAuth.mockResolvedValueOnce({
      user: { id: TEST_USER_ALLOWED_ID, email: 'allowed@test.com' },
      organizationId: ALLOWED_ORG,
      sessionId: 'sess_1',
      accessToken: 'tok_1',
    });

    const sessionUser = await requireUser();

    expect(sessionUser.workosUserId).toBe(TEST_USER_ALLOWED_ID);
    expect(sessionUser.email).toBe('allowed@test.com');
    expect(sessionUser.orgId).toBe(ALLOWED_ORG);
    expect(sessionUser.appRole).toBe('evaluator'); // default role
    expect(sessionUser.id).toBeTruthy(); // uuid assigned by DB

    // Verify row actually exists in DB
    const rows = await db
      .select()
      .from(users)
      .where(eq(users.workosUserId, TEST_USER_ALLOWED_ID));
    expect(rows).toHaveLength(1);
    expect(rows[0].email).toBe('allowed@test.com');
  });

  it('(a) is idempotent — upsert on second call updates without duplication', async () => {
    mockWithAuth.mockResolvedValueOnce({
      user: { id: TEST_USER_ALLOWED_ID, email: 'allowed-updated@test.com' },
      organizationId: ALLOWED_ORG,
      sessionId: 'sess_2',
      accessToken: 'tok_2',
    });

    const sessionUser = await requireUser();

    expect(sessionUser.email).toBe('allowed-updated@test.com');

    const rows = await db
      .select()
      .from(users)
      .where(eq(users.workosUserId, TEST_USER_ALLOWED_ID));
    // Still just one row
    expect(rows).toHaveLength(1);
  });

  it('(b) throws UnauthorizedError for a user in a different org', async () => {
    mockWithAuth.mockResolvedValue({
      user: { id: 'workos_other_org_99999', email: 'other@test.com' },
      organizationId: OTHER_ORG,
      sessionId: 'sess_3',
      accessToken: 'tok_3',
    });

    await expect(requireUser()).rejects.toThrow(UnauthorizedError);
    await expect(requireUser()).rejects.toThrow('Organization not allowed');

    // Reset to avoid leaking this mock into other tests
    mockWithAuth.mockReset();
  });
});

describe('requireRole', () => {
  const evaluatorUser: SessionUser = {
    id: 'uuid-eval',
    workosUserId: 'workos_eval',
    email: 'eval@test.com',
    appRole: 'evaluator',
    orgId: ALLOWED_ORG,
  };

  const adminUser: SessionUser = {
    id: 'uuid-admin',
    workosUserId: 'workos_admin',
    email: 'admin@test.com',
    appRole: 'admin',
    orgId: ALLOWED_ORG,
  };

  it('(c) throws ForbiddenError when evaluator requires admin role', () => {
    expect(() => requireRole(evaluatorUser, 'admin')).toThrow(ForbiddenError);
    expect(() => requireRole(evaluatorUser, 'admin')).toThrow('admin');
  });

  it('(d) does not throw when adminUser has the admin role', () => {
    expect(() => requireRole(adminUser, 'admin')).not.toThrow();
  });

  it('allows multiple accepted roles', () => {
    expect(() => requireRole(evaluatorUser, 'evaluator', 'admin')).not.toThrow();
  });
});
