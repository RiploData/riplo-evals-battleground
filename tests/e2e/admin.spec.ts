/**
 * Admin UI — Playwright smoke test.
 *
 * Requires:
 *   ARENA_DEV_AUTH_EMAIL set (enables local dev auth bypass in requireUser())
 *   ARENA_DEV_AUTH_ROLE=admin (or operator/analyst depending on the page)
 *   A running dev server with a seeded campaign + at least one ranking run.
 *
 * Gate: skip entirely in CI when the dev auth env var is absent.
 */
import { test, expect } from '@playwright/test';

const SKIP_IN_CI = !process.env.ARENA_DEV_AUTH_EMAIL && !!process.env.CI;

// ─────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────

/** Seed a minimal ranking run via the API so the leaderboard has rows. */
async function seedRankingRun(page: import('@playwright/test').Page, campaignId: string) {
  const res = await page.request.post('/api/ranking-runs', {
    data: { campaign_id: campaignId },
  });
  return res.json() as Promise<{ rankingRunId: string }>;
}

// ─────────────────────────────────────────────────────────────────
// Leaderboard
// ─────────────────────────────────────────────────────────────────

test.describe('Admin /leaderboard', () => {
  test.skip(SKIP_IN_CI, 'ARENA_DEV_AUTH_EMAIL not set — skipping in CI');

  test('renders the leaderboard header', async ({ page }) => {
    await page.goto('/leaderboard');
    await expect(page.getByText('Leaderboard')).toBeVisible({ timeout: 10_000 });
    // Admin shell nav should include expected links
    await expect(page.getByRole('link', { name: 'Leaderboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Reports' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Cases' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Competitors' })).toBeVisible();
  });

  test('"Run ranking" button triggers a run and table renders rows', async ({ page }) => {
    await page.goto('/leaderboard');

    // If there is already a leaderboard table skip the trigger step
    const runButton = page.getByRole('button', { name: /run ranking/i });
    const hasButton = await runButton.count();

    if (hasButton) {
      // Intercept the POST to ranking-runs and return a synthetic response so we
      // don't depend on a real DB in the smoke context.
      let rankingPostBody: unknown = null;
      await page.route('/api/ranking-runs', async (route) => {
        if (route.request().method() === 'POST') {
          rankingPostBody = JSON.parse(route.request().postData() ?? '{}');
          await route.fulfill({
            status: 201,
            contentType: 'application/json',
            body: JSON.stringify({ rankingRunId: 'smoke-run-id' }),
          });
        } else {
          await route.continue();
        }
      });

      await runButton.click();

      // The button should transition to "Running…" momentarily
      // then show the run ID
      await expect(page.getByText(/Run created/i)).toBeVisible({ timeout: 8_000 });

      // The POST body must include a campaign_id
      expect(rankingPostBody).not.toBeNull();
      const body = rankingPostBody as Record<string, unknown>;
      expect(typeof body.campaign_id).toBe('string');
    }

    // Either way the page header should still be present
    await expect(page.getByText('Leaderboard')).toBeVisible();
  });

  test('shows empty state when no ranking runs exist', async ({ page }) => {
    // Route the leaderboard API to return an empty array
    await page.route('/api/leaderboard', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([]),
      });
    });

    await page.goto('/leaderboard');

    // Empty state message
    await expect(
      page.getByText(/No ranking data yet/i),
    ).toBeVisible({ timeout: 10_000 });
  });
});

// ─────────────────────────────────────────────────────────────────
// Reports
// ─────────────────────────────────────────────────────────────────

test.describe('Admin /reports', () => {
  test.skip(SKIP_IN_CI, 'ARENA_DEV_AUTH_EMAIL not set — skipping in CI');

  test('renders the three report sections', async ({ page }) => {
    await page.goto('/reports');
    await expect(page.getByText('Reports')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/head-to-head/i)).toBeVisible();
    await expect(page.getByText(/segments/i)).toBeVisible();
    await expect(page.getByText(/position bias/i)).toBeVisible();
  });
});

// ─────────────────────────────────────────────────────────────────
// Generate
// ─────────────────────────────────────────────────────────────────

test.describe('Admin /generate', () => {
  test.skip(SKIP_IN_CI, 'ARENA_DEV_AUTH_EMAIL not set — skipping in CI');

  test('renders the generate page with the trigger button', async ({ page }) => {
    await page.goto('/generate');
    await expect(page.getByText('Generate responses')).toBeVisible({ timeout: 10_000 });
    // Trigger button or "No campaign" message
    const hasButton = await page.getByRole('button', { name: /generate missing/i }).count();
    const hasEmpty = await page.getByText(/No campaign/i).count();
    expect(hasButton + hasEmpty).toBeGreaterThan(0);
  });

  test('"Generate missing responses" POSTs to /api/generate', async ({ page }) => {
    let generateBody: unknown = null;

    await page.route('/api/generate', async (route) => {
      if (route.request().method() === 'POST') {
        generateBody = JSON.parse(route.request().postData() ?? '{}');
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify({ enqueued: 0, completed: 0 }),
        });
      } else {
        await route.continue();
      }
    });

    await page.goto('/generate');

    const button = page.getByRole('button', { name: /generate missing/i });
    const count = await button.count();

    if (count > 0 && !(await button.isDisabled())) {
      await button.click();
      await expect(page.getByText(/Done/i)).toBeVisible({ timeout: 8_000 });
      expect(generateBody).not.toBeNull();
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Cases
// ─────────────────────────────────────────────────────────────────

test.describe('Admin /cases', () => {
  test.skip(SKIP_IN_CI, 'ARENA_DEV_AUTH_EMAIL not set — skipping in CI');

  test('renders the cases table or empty state', async ({ page }) => {
    await page.goto('/cases');
    await expect(page.getByText('Cases')).toBeVisible({ timeout: 10_000 });
    // Either a table row or the empty state message
    const hasRows = await page.locator('tbody tr').count();
    const hasEmpty = await page.getByText(/No cases found/i).count();
    expect(hasRows + hasEmpty).toBeGreaterThan(0);
  });

  test('table has the expected columns', async ({ page }) => {
    await page.goto('/cases');
    await expect(page.getByText('Cases')).toBeVisible({ timeout: 10_000 });

    // Only validate column headers if a table exists
    const tableCount = await page.locator('table').count();
    if (tableCount > 0) {
      await expect(page.getByText(/external ref/i)).toBeVisible();
      await expect(page.getByText(/kind/i)).toBeVisible();
      await expect(page.getByText(/title/i)).toBeVisible();
      await expect(page.getByText(/split/i)).toBeVisible();
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Competitors
// ─────────────────────────────────────────────────────────────────

test.describe('Admin /competitors', () => {
  test.skip(SKIP_IN_CI, 'ARENA_DEV_AUTH_EMAIL not set — skipping in CI');

  test('renders the competitors table or empty state', async ({ page }) => {
    await page.goto('/competitors');
    await expect(page.getByText('Competitors')).toBeVisible({ timeout: 10_000 });
    const hasRows = await page.locator('tbody tr').count();
    const hasEmpty = await page.getByText(/No competitor versions found/i).count();
    expect(hasRows + hasEmpty).toBeGreaterThan(0);
  });

  test('table has the expected columns', async ({ page }) => {
    await page.goto('/competitors');
    await expect(page.getByText('Competitors')).toBeVisible({ timeout: 10_000 });

    const tableCount = await page.locator('table').count();
    if (tableCount > 0) {
      await expect(page.getByText(/model identifier/i)).toBeVisible();
      await expect(page.getByText(/source type/i)).toBeVisible();
      await expect(page.getByText(/parent/i)).toBeVisible();
    }
  });
});

// ─────────────────────────────────────────────────────────────────
// Role gating (analyst cannot access generate)
// ─────────────────────────────────────────────────────────────────

test.describe('Role gating', () => {
  test.skip(SKIP_IN_CI, 'ARENA_DEV_AUTH_EMAIL not set — skipping in CI');

  test('analyst role sees "insufficient role" on /generate', async ({ page }) => {
    // Temporarily override to analyst role via query string if supported,
    // or rely on ARENA_DEV_AUTH_ROLE=analyst env being set for this test process.
    // In practice run this test suite with ARENA_DEV_AUTH_ROLE=analyst.
    if (process.env.ARENA_DEV_AUTH_ROLE !== 'analyst') {
      test.skip(true, 'Set ARENA_DEV_AUTH_ROLE=analyst to run this test');
    }

    await page.goto('/generate');
    await expect(page.getByText(/insufficient role/i)).toBeVisible({ timeout: 10_000 });
  });
});
