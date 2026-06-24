import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  judgments,
  assignments,
  comparisons,
  cases,
  caseVersions,
  competitors,
  competitorVersions,
} from '@/db/schema';

export interface JudgmentExportRecord {
  judgment_id: string;
  assignment_id: string;
  left_response_id: string;
  right_response_id: string;
  outcome: string;
  preferred_response_id: string | null;
  time_to_first_action_ms: number | null;
  total_duration_ms: number | null;
  rewrite_response_id: string | null;
  rewrite_forked_from: string | null;
}

export async function exportJudgments(
  campaignId: string,
  format: 'csv' | 'json',
): Promise<string> {
  const rows = await db
    .select({
      judgment_id: judgments.id,
      assignment_id: judgments.assignmentId,
      left_response_id: assignments.leftResponseId,
      right_response_id: assignments.rightResponseId,
      outcome: judgments.outcome,
      preferred_response_id: judgments.preferredResponseId,
      time_to_first_action_ms: judgments.timeToFirstActionMs,
      total_duration_ms: judgments.totalDurationMs,
      rewrite_response_id: judgments.rewriteResponseId,
      rewrite_forked_from: judgments.rewriteForkedFrom,
    })
    .from(judgments)
    .innerJoin(assignments, eq(judgments.assignmentId, assignments.id))
    .innerJoin(comparisons, eq(assignments.comparisonId, comparisons.id))
    .where(eq(comparisons.campaignId, campaignId));

  const records: JudgmentExportRecord[] = rows.map((r) => ({
    judgment_id: r.judgment_id,
    assignment_id: r.assignment_id,
    left_response_id: r.left_response_id,
    right_response_id: r.right_response_id,
    outcome: r.outcome,
    preferred_response_id: r.preferred_response_id ?? null,
    time_to_first_action_ms: r.time_to_first_action_ms ?? null,
    total_duration_ms: r.total_duration_ms ?? null,
    rewrite_response_id: r.rewrite_response_id ?? null,
    rewrite_forked_from: r.rewrite_forked_from ?? null,
  }));

  if (format === 'json') {
    return JSON.stringify(records);
  }

  // CSV
  const headers = [
    'judgment_id',
    'assignment_id',
    'left_response_id',
    'right_response_id',
    'outcome',
    'preferred_response_id',
    'time_to_first_action_ms',
    'total_duration_ms',
    'rewrite_response_id',
    'rewrite_forked_from',
  ];

  const csvLines = [headers.join(',')];
  for (const rec of records) {
    const row = headers.map((h) => {
      const val = rec[h as keyof JudgmentExportRecord];
      if (val === null || val === undefined) return '';
      const str = String(val);
      // Escape commas and quotes
      if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return `"${str.replace(/"/g, '""')}"`;
      }
      return str;
    });
    csvLines.push(row.join(','));
  }

  return csvLines.join('\n');
}

export interface CaseVersionRecord {
  case_version_id: string;
  external_ref: string | null;
  kind: string;
  title: string;
  tags: string[];
  dataset_split: string;
}

export async function listCases(): Promise<CaseVersionRecord[]> {
  const rows = await db
    .select({
      case_version_id: caseVersions.id,
      external_ref: cases.externalRef,
      kind: caseVersions.kind,
      title: caseVersions.title,
      tags: caseVersions.tags,
      dataset_split: caseVersions.datasetSplit,
    })
    .from(caseVersions)
    .innerJoin(cases, eq(caseVersions.caseId, cases.id));

  return rows.map((r) => ({
    case_version_id: r.case_version_id,
    external_ref: r.external_ref ?? null,
    kind: r.kind,
    title: r.title,
    tags: r.tags,
    dataset_split: r.dataset_split,
  }));
}

export interface CompetitorVersionRecord {
  competitor_version_id: string;
  name: string;
  version: number;
  model_identifier: string | null;
  source_type: string;
  parent_competitor_version_id: string | null;
}

export async function listCompetitorVersions(): Promise<CompetitorVersionRecord[]> {
  const rows = await db
    .select({
      competitor_version_id: competitorVersions.id,
      name: competitors.name,
      version: competitorVersions.version,
      model_identifier: competitorVersions.modelIdentifier,
      source_type: competitorVersions.sourceType,
      parent_competitor_version_id: competitorVersions.parentCompetitorVersionId,
    })
    .from(competitorVersions)
    .innerJoin(competitors, eq(competitorVersions.competitorId, competitors.id));

  return rows.map((r) => ({
    competitor_version_id: r.competitor_version_id,
    name: r.name,
    version: r.version,
    model_identifier: r.model_identifier ?? null,
    source_type: r.source_type,
    parent_competitor_version_id: r.parent_competitor_version_id ?? null,
  }));
}
