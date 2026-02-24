/**
 * Runner Types — Automated Migration Pipeline
 *
 * Types for the one-command migration runner.
 * The runner orchestrates the full 5-step pipeline without requiring
 * the consultant to understand prompts, chains, or MCP tools.
 */

import type { IntegrationIntent } from '../shared/integration-intent.js';
import type { BuildResult } from '../stage3-build/package-builder.js';
import type { QualityReport } from '../validation/quality-scorer.js';
import type { WorkflowValidationResult } from '../validation/workflow-validator.js';

// ─── Pipeline Steps ───────────────────────────────────────────────────────────

export type MigrationStep = 'parse' | 'reason' | 'scaffold' | 'validate' | 'review' | 'report';

export interface StepProgress {
  step: MigrationStep;
  message: string;
  detail?: string | undefined;
}

// ─── Options ──────────────────────────────────────────────────────────────────

export interface MigrationRunOptions {
  /** Directory containing BizTalk artifacts (.odx, .btm, .btp, BindingInfo.xml) */
  artifactDir: string;
  /** Human-readable application name (used in output file names and report) */
  appName: string;
  /** Directory to write generated Logic Apps project files */
  outputDir: string;
  /** Progress callback — called at the start of each pipeline step */
  onProgress?: (progress: StepProgress) => void;
  /** Skip Claude enrichment — use partial IntegrationIntent as-is (dev/offline mode) */
  skipEnrichment?: boolean;
}

// ─── Result ───────────────────────────────────────────────────────────────────

export interface MigrationRunResult {
  /** Overall pipeline success. False only when zero artifacts are found. */
  success: boolean;
  /** Final validated build result (undefined if scaffold step failed) */
  buildResult?: BuildResult;
  /** Quality score and grade (undefined if validation step was skipped) */
  qualityReport?: QualityReport;
  /** Markdown migration report (always present on success) */
  migrationReport: string;
  /** Non-fatal errors accumulated during the run (parse failures, enrichment failures) */
  errors: string[];
  /** Warnings from build and validation steps */
  warnings: string[];
  /** Wall-clock timings per step in milliseconds */
  timings: Partial<Record<MigrationStep, number>>;
}

// ─── Claude Enrichment ────────────────────────────────────────────────────────

export interface EnrichmentRequest {
  /** Partial IntegrationIntent with TODO_CLAUDE markers */
  partialIntent: IntegrationIntent;
  /** Application name for context */
  appName: string;
  /** Detected integration patterns */
  patterns: string[];
  /** Gap analysis summary for enrichment context */
  gapSummary?: string;
}

export interface EnrichmentResponse {
  /** Fully enriched IntegrationIntent (no TODO_CLAUDE markers) */
  enrichedIntent: IntegrationIntent;
  /** Claude's notes on what was enriched */
  notes?: string;
}

// ─── Claude Review ────────────────────────────────────────────────────────────

export interface ReviewRequest {
  /** Workflow JSON string to review */
  workflowJson: string;
  /** Validation issues to fix */
  validationIssues: WorkflowValidationResult;
  /** Current quality grade (e.g. 'C', 'D') */
  currentGrade: string;
  /** Current quality score */
  currentScore: number;
}

export interface ReviewResponse {
  /** Fixed workflow JSON string */
  fixedWorkflowJson: string;
  /** List of changes made */
  changesApplied: string[];
}

// Re-export for convenience
export type { BuildResult, QualityReport, WorkflowValidationResult };
