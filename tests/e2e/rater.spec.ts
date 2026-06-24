/**
 * Rater battle UI — Playwright smoke test.
 *
 * Requires:
 *   ARENA_DEV_AUTH_EMAIL set (enables local dev auth bypass in requireUser())
 *   A running dev server with at least one seeded battle available via GET /battle.
 *
 * Gate: skip the test entirely in CI when the dev auth env var is absent, since
 * WorkOS cannot complete an interactive login in a headless CI environment.
 * The authoritative loop test (Task 22) runs this locally with the seeded corpus.
 */
import { test, expect } from '@playwright/test';

const SKIP_IN_CI = !process.env.ARENA_DEV_AUTH_EMAIL && !!process.env.CI;

test.describe('Rater /battle smoke', () => {
  test.skip(SKIP_IN_CI, 'ARENA_DEV_AUTH_EMAIL not set — skipping in CI (authoritative run is Task 22)');

  test('shows two option panels and the blinded marker', async ({ page }) => {
    await page.goto('/battle');

    // Wait for the battle to load (the two option panels)
    // Options are rendered as <article> elements with an A / B label badge
    const optionA = page.locator('article').filter({ hasText: 'A' }).first();
    const optionB = page.locator('article').filter({ hasText: 'B' }).first();

    await expect(optionA).toBeVisible({ timeout: 10_000 });
    await expect(optionB).toBeVisible({ timeout: 10_000 });

    // The "Blinded · randomised" marker must be present in the header
    await expect(page.getByText('Blinded · randomised')).toBeVisible();
  });

  test('pressing A votes and advances to the next battle', async ({ page }) => {
    // Intercept POST /vote to confirm the request is sent correctly
    const voteRequests: { body: string }[] = [];
    await page.route('/vote', async (route) => {
      const body = route.request().postData() ?? '';
      voteRequests.push({ body });
      // Respond with 201 to simulate a successful vote
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ judgment_id: 'test-jid', next: '/battle' }),
      });
    });

    // Intercept GET /battle to return a controlled payload on the second call
    let battleCalls = 0;
    const firstBattle = {
      assignment_id: 'assign-1',
      ui_version: '1',
      task: {
        case_external_ref: 'T001',
        kind: 'compression',
        title: 'Test battle title',
        guidance: 'Judge carefully.',
        output_spec: { target: 'Summary', parts: [{ type: 'text', label: 'Body', note: '1 para' }] },
        source_blocks: [{ type: 'text', text: 'Source content here.' }],
      },
      options: [
        { label: 'A', response_id: 'r1', body_text: 'Response A text.' },
        { label: 'B', response_id: 'r2', body_text: 'Response B text.' },
      ],
    };
    const secondBattle = {
      ...firstBattle,
      assignment_id: 'assign-2',
      task: { ...firstBattle.task, title: 'Second battle title' },
    };

    await page.route('/battle', async (route) => {
      battleCalls++;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(battleCalls === 1 ? firstBattle : secondBattle),
      });
    });

    await page.goto('/battle');

    // Wait for first battle to render
    await expect(page.getByText('Response A text.')).toBeVisible({ timeout: 10_000 });

    // Press A to vote
    await page.keyboard.press('a');

    // Flash toast should appear
    await expect(page.getByText('A is better')).toBeVisible({ timeout: 5_000 });

    // After advance, second battle should appear
    await expect(page.getByText('Second battle title')).toBeVisible({ timeout: 5_000 });

    // Confirm the POST /vote was called with outcome:'left'
    expect(voteRequests.length).toBeGreaterThan(0);
    const parsed = JSON.parse(voteRequests[0].body);
    expect(parsed.outcome).toBe('left');
    expect(parsed.assignment_id).toBe('assign-1');
    expect(typeof parsed.time_to_first_action_ms).toBe('number');
    expect(typeof parsed.total_duration_ms).toBe('number');
  });

  test('rewrite flow: R → A → submits with both_unacceptable outcome', async ({ page }) => {
    const voteRequests: { body: string }[] = [];
    await page.route('/vote', async (route) => {
      voteRequests.push({ body: route.request().postData() ?? '' });
      await route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ judgment_id: 'test-jid-rw', next: '/battle' }),
      });
    });

    const battle = {
      assignment_id: 'assign-rw',
      ui_version: '1',
      task: {
        case_external_ref: 'T002',
        kind: 'judgment',
        title: 'Rewrite battle',
        output_spec: { target: 'One-pager', parts: [] },
        source_blocks: [{ type: 'text', text: 'Source.' }],
      },
      options: [
        { label: 'A', response_id: 'r-a', body_text: 'Original A.' },
        { label: 'B', response_id: 'r-b', body_text: 'Original B.' },
      ],
    };

    await page.route('/battle', async (route) => {
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(battle) });
    });

    await page.goto('/battle');
    await expect(page.getByText('Original A.')).toBeVisible({ timeout: 10_000 });

    // Press R to open the rewrite chooser
    await page.keyboard.press('r');
    await expect(page.getByText('Rewrite from…')).toBeVisible();

    // Press A to fork from version A
    await page.keyboard.press('a');
    await expect(page.getByText('Editing from A')).toBeVisible();

    // Edit the textarea
    const textarea = page.locator('textarea');
    await expect(textarea).toBeVisible();
    await textarea.fill('My improved rewrite.');

    // Click Save & continue
    await page.getByText('Save & continue').click();

    // Confirm vote body
    expect(voteRequests.length).toBeGreaterThan(0);
    const parsed = JSON.parse(voteRequests[0].body);
    expect(parsed.outcome).toBe('both_unacceptable');
    expect(parsed.rewrite?.forked_from).toBe('a');
    expect(parsed.rewrite?.body_text).toBe('My improved rewrite.');
  });
});
