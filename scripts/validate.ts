/**
 * scripts/validate.ts  (npm run cases:validate)
 *
 * Validates all case.json and competitor files against their Zod schemas.
 * No network or DB access required.
 * Exits nonzero on any validation failure.
 */

import path from 'node:path';
import fs from 'node:fs';
import { glob } from 'glob';
import { validateCaseFile } from '../src/corpus/case-schema';
import { validateCompetitor, validateCompetitorVersion } from '../src/corpus/competitor-schema';
import { validateSuiteConfig, validateCampaignConfig } from '../src/corpus/config-schema';

const ROOT = process.cwd();

let errors = 0;
let checked = 0;

function fail(file: string, err: unknown): void {
  errors++;
  const message = err instanceof Error ? err.message : String(err);
  console.error(`FAIL  ${file}`);
  console.error(`      ${message.split('\n')[0]}`);
}

function ok(file: string): void {
  checked++;
  console.log(`OK    ${file}`);
}

// ── Validate config files ─────────────────────────────────────────────────────

function validateConfigFiles(): void {
  console.log('\n--- Config files ---');

  const suiteConfigPath = path.join(ROOT, 'config', 'suites', 'default.json');
  if (fs.existsSync(suiteConfigPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(suiteConfigPath, 'utf-8'));
      validateSuiteConfig(raw);
      ok(path.relative(ROOT, suiteConfigPath));
    } catch (err) {
      fail(path.relative(ROOT, suiteConfigPath), err);
    }
  } else {
    console.warn(`SKIP  config/suites/default.json (not found)`);
  }

  const campaignConfigPath = path.join(ROOT, 'config', 'campaign.json');
  if (fs.existsSync(campaignConfigPath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(campaignConfigPath, 'utf-8'));
      validateCampaignConfig(raw);
      ok(path.relative(ROOT, campaignConfigPath));
    } catch (err) {
      fail(path.relative(ROOT, campaignConfigPath), err);
    }
  } else {
    console.warn(`SKIP  config/campaign.json (not found)`);
  }
}

// ── Validate case files ───────────────────────────────────────────────────────

async function validateCaseFiles(): Promise<void> {
  console.log('\n--- Case files ---');

  const casesDir = path.join(ROOT, 'cases');
  if (!fs.existsSync(casesDir)) {
    console.warn('SKIP  cases/ directory not found');
    return;
  }

  const pattern = path.join(casesDir, '**/case.json').replace(/\\/g, '/');
  const files = await glob(pattern, { nodir: true });

  if (files.length === 0) {
    console.warn('SKIP  no case.json files found under cases/');
    return;
  }

  for (const filePath of files.sort()) {
    const rel = path.relative(ROOT, filePath);
    try {
      const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
      validateCaseFile(raw);
      ok(rel);
    } catch (err) {
      fail(rel, err);
    }
  }
}

// ── Validate competitor files ─────────────────────────────────────────────────

async function validateCompetitorFiles(): Promise<void> {
  console.log('\n--- Competitor files ---');

  const competitorsDir = path.join(ROOT, 'competitors');
  if (!fs.existsSync(competitorsDir)) {
    console.warn('SKIP  competitors/ directory not found');
    return;
  }

  const entries = fs.readdirSync(competitorsDir, { withFileTypes: true });
  const slugDirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();

  if (slugDirs.length === 0) {
    console.warn('SKIP  no competitor directories found');
    return;
  }

  for (const slug of slugDirs) {
    const slugDir = path.join(competitorsDir, slug);

    // Validate competitor.json
    const competitorJsonPath = path.join(slugDir, 'competitor.json');
    if (!fs.existsSync(competitorJsonPath)) {
      console.warn(`SKIP  competitors/${slug}/competitor.json (not found)`);
      continue;
    }

    try {
      const raw = JSON.parse(fs.readFileSync(competitorJsonPath, 'utf-8'));
      validateCompetitor(raw);
      ok(`competitors/${slug}/competitor.json`);
    } catch (err) {
      fail(`competitors/${slug}/competitor.json`, err);
      continue;
    }

    // Validate version files
    const versionsDir = path.join(slugDir, 'versions');
    if (!fs.existsSync(versionsDir)) continue;

    const versionFiles = fs
      .readdirSync(versionsDir)
      .filter((f) => f.endsWith('.json'))
      .sort();

    for (const versionFile of versionFiles) {
      const versionFilePath = path.join(versionsDir, versionFile);
      const rel = `competitors/${slug}/versions/${versionFile}`;
      try {
        const raw = JSON.parse(fs.readFileSync(versionFilePath, 'utf-8'));
        validateCompetitorVersion(raw);
        ok(rel);
      } catch (err) {
        fail(rel, err);
      }
    }
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log('=== Riplo Arena: Corpus Validation ===');

  validateConfigFiles();
  await validateCaseFiles();
  await validateCompetitorFiles();

  console.log(`\n=== Result: ${checked} passed, ${errors} failed ===`);

  if (errors > 0) {
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error('Validation script error:', err);
  process.exit(1);
});
