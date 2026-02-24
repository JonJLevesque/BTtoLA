/**
 * Runner module — barrel exports
 *
 * The runner orchestrates the full BizTalk → Logic Apps migration pipeline
 * in a single `runMigration()` function call.
 */

export { runMigration }                from './migration-runner.js';
export { ClaudeClient }                from './claude-client.js';
export { generateMigrationReport }     from './report-generator.js';
export { writeOutput }                 from './output-writer.js';
export type {
  MigrationRunOptions,
  MigrationRunResult,
  MigrationStep,
  StepProgress,
  EnrichmentRequest,
  EnrichmentResponse,
  ReviewRequest,
  ReviewResponse,
} from './types.js';
export type { ReportInput } from './report-generator.js';
export type { WriteOptions } from './output-writer.js';
