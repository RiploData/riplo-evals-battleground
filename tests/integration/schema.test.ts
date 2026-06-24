import 'dotenv/config';
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';

// Use a raw pg pool to test raw SQL behaviour including trigger errors.
// Tests run against the real DB (docker compose must be up on port 5544).
// Each test is wrapped in a transaction that rolls back so the DB stays clean.

let pool: Pool;

beforeAll(() => {
  pool = new Pool({ connectionString: process.env.DATABASE_URL });
});

afterAll(async () => {
  await pool.end();
});

/** Run a block inside a transaction that always rolls back. */
async function withRollback(fn: (client: import('pg').PoolClient) => Promise<void>) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await fn(client);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
}

describe('schema integration', () => {
  it('allows a plain users insert', async () => {
    await withRollback(async (client) => {
      const { rows } = await client.query<{ id: string }>(`
        INSERT INTO users (workos_user_id, email, org_id)
        VALUES ('wos_test_001', 'test@example.com', 'org_test')
        RETURNING id
      `);
      expect(rows[0].id).toBeTruthy();
    });
  });

  it('blocks UPDATE of competitor_versions.content_hash (immutability guard)', async () => {
    await withRollback(async (client) => {
      // Insert a minimal competitor
      const {
        rows: [{ competitor_id }],
      } = await client.query<{ competitor_id: string }>(`
        INSERT INTO competitors (name, competitor_type)
        VALUES ('Test Competitor', 'model_runner')
        RETURNING id AS competitor_id
      `);

      // Insert a competitor_version
      const {
        rows: [{ cv_id }],
      } = await client.query<{ cv_id: string }>(`
        INSERT INTO competitor_versions
          (competitor_id, version, content_hash)
        VALUES ($1, 1, 'hash-abc123')
        RETURNING id AS cv_id
      `, [competitor_id]);

      // Attempt to mutate content_hash — should throw
      await expect(
        client.query(
          `UPDATE competitor_versions SET content_hash = 'tampered' WHERE id = $1`,
          [cv_id],
        ),
      ).rejects.toThrow(/immutable/i);
    });
  });

  it('blocks UPDATE of responses.body_text (immutability guard)', async () => {
    await withRollback(async (client) => {
      // Insert a suite, case, case_version (required FK chain for responses)
      const {
        rows: [{ suite_id }],
      } = await client.query<{ suite_id: string }>(`
        INSERT INTO suites (name) VALUES ('Test Suite') RETURNING id AS suite_id
      `);

      const {
        rows: [{ case_id }],
      } = await client.query<{ case_id: string }>(`
        INSERT INTO cases (suite_id) VALUES ($1) RETURNING id AS case_id
      `, [suite_id]);

      const {
        rows: [{ cv_id }],
      } = await client.query<{ cv_id: string }>(`
        INSERT INTO case_versions
          (case_id, version, kind, title, output_spec_json, runner_input_json,
           evaluator_context_json, content_hash)
        VALUES ($1, 1, 'compression', 'Test Case',
                '{}', '{}', '{}', 'case-hash-001')
        RETURNING id AS cv_id
      `, [case_id]);

      // Insert a response
      const {
        rows: [{ resp_id }],
      } = await client.query<{ resp_id: string }>(`
        INSERT INTO responses
          (case_version_id, origin_type, body_text, content_hash)
        VALUES ($1, 'independent_human_baseline', 'original body', 'resp-hash-001')
        RETURNING id AS resp_id
      `, [cv_id]);

      // Attempt to mutate body_text — should throw
      await expect(
        client.query(
          `UPDATE responses SET body_text = 'tampered' WHERE id = $1`,
          [resp_id],
        ),
      ).rejects.toThrow(/immutable/i);
    });
  });

  it('blocks UPDATE of case_versions.content_hash (immutability guard)', async () => {
    await withRollback(async (client) => {
      const {
        rows: [{ suite_id }],
      } = await client.query<{ suite_id: string }>(`
        INSERT INTO suites (name) VALUES ('Test Suite CV') RETURNING id AS suite_id
      `);
      const {
        rows: [{ case_id }],
      } = await client.query<{ case_id: string }>(
        `INSERT INTO cases (suite_id) VALUES ($1) RETURNING id AS case_id`,
        [suite_id],
      );
      const {
        rows: [{ cv_id }],
      } = await client.query<{ cv_id: string }>(
        `
        INSERT INTO case_versions
          (case_id, version, kind, title, output_spec_json, runner_input_json,
           evaluator_context_json, content_hash)
        VALUES ($1, 1, 'compression', 'Test Case',
                '{}', '{}', '{}', 'case-hash-immutable')
        RETURNING id AS cv_id
      `,
        [case_id],
      );

      // Attempt to mutate content_hash — should throw
      await expect(
        client.query(
          `UPDATE case_versions SET content_hash = 'tampered' WHERE id = $1`,
          [cv_id],
        ),
      ).rejects.toThrow(/immutable/i);
    });
  });

  it('allows UPDATE of non-contract columns on responses (status)', async () => {
    await withRollback(async (client) => {
      const {
        rows: [{ suite_id }],
      } = await client.query<{ suite_id: string }>(`
        INSERT INTO suites (name) VALUES ('Test Suite 2') RETURNING id AS suite_id
      `);
      const {
        rows: [{ case_id }],
      } = await client.query<{ case_id: string }>(`
        INSERT INTO cases (suite_id) VALUES ($1) RETURNING id AS case_id
      `, [suite_id]);
      const {
        rows: [{ cv_id }],
      } = await client.query<{ cv_id: string }>(`
        INSERT INTO case_versions
          (case_id, version, kind, title, output_spec_json, runner_input_json,
           evaluator_context_json, content_hash)
        VALUES ($1, 1, 'compression', 'Test Case',
                '{}', '{}', '{}', 'case-hash-002')
        RETURNING id AS cv_id
      `, [case_id]);
      const {
        rows: [{ resp_id }],
      } = await client.query<{ resp_id: string }>(`
        INSERT INTO responses
          (case_version_id, origin_type, body_text, content_hash)
        VALUES ($1, 'independent_human_baseline', 'original body 2', 'resp-hash-002')
        RETURNING id AS resp_id
      `, [cv_id]);

      // Updating status (non-contract) should succeed
      await expect(
        client.query(
          `UPDATE responses SET status = 'invalidated' WHERE id = $1`,
          [resp_id],
        ),
      ).resolves.toBeDefined();
    });
  });
});
