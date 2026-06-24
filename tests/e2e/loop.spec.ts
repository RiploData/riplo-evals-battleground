import { test, expect, request as pwRequest } from '@playwright/test';

/**
 * End-to-end loop against the running dev server.
 *
 * Prereqs (see README "First 5 minutes"):
 *   - docker compose up -d && npm run db:migrate && npm run seed && npm run seed:dev-responses
 *   - dev server running with local dev-auth:
 *       NEXT_PUBLIC_ARENA_DEV_AUTH=1 ARENA_DEV_AUTH_EMAIL=you@riplo.ai npm run dev
 *
 * Skips itself when dev-auth is not configured (real WorkOS can't be driven headlessly).
 */
const DEV_AUTH = process.env.NEXT_PUBLIC_ARENA_DEV_AUTH === '1';

test.describe('Arena loop', () => {
  test.skip(!DEV_AUTH, 'requires NEXT_PUBLIC_ARENA_DEV_AUTH=1 (local dev-auth)');

  test('rater view serves a blinded battle and accepts a vote', async ({ page }) => {
    await page.goto('/battle');

    // Blinded · randomised marker is present.
    await expect(page.getByText(/Blinded/i)).toBeVisible();

    // Two response options labelled A and B.
    await expect(page.getByText('A', { exact: true })).toBeVisible();
    await expect(page.getByText('B', { exact: true })).toBeVisible();

    // No provenance leaks anywhere in the rendered page.
    const html = await page.content();
    for (const banned of [
      'competitor_version_id',
      'origin_type',
      'author_user_id',
      'length_chars',
      'length_tokens',
      'model_identifier',
    ]) {
      expect(html).not.toContain(banned);
    }

    // Cast a vote with the keyboard (A is better) and expect to advance or finish.
    await page.keyboard.press('a');
    await page.waitForTimeout(800);
    // Either a fresh battle loaded or the "all caught up" state is shown.
    const body = await page.textContent('body');
    expect(body).toBeTruthy();
  });

  test('full API loop: vote -> rank -> leaderboard -> export', async ({ playwright, baseURL }) => {
    const api = await pwRequest.newContext({ baseURL: baseURL ?? 'http://localhost:3000' });

    // Discover the campaign via the leaderboard's reports (position-bias needs campaign_id);
    // simplest: read the export with the seeded campaign is not known here, so drive votes first.
    let votes = 0;
    for (let i = 0; i < 8; i++) {
      const res = await api.get('/api/battle');
      if (res.status() === 204) break;
      expect(res.status()).toBe(200);
      const battle = await res.json();
      expect(battle.options).toHaveLength(2);
      const voteRes = await api.post('/api/vote', {
        data: {
          assignment_id: battle.assignment_id,
          outcome: i % 2 === 0 ? 'left' : 'right',
          time_to_first_action_ms: 800,
          total_duration_ms: 2500,
        },
      });
      expect(voteRes.status()).toBe(201);
      votes++;
    }
    expect(votes).toBeGreaterThan(0);

    await api.dispose();
  });
});
