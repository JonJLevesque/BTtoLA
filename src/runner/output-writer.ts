/**
 * Output Writer — Write BuildResult + migration-report.md to disk
 *
 * Produces a Logic Apps Standard project layout:
 *
 *   {outputDir}/
 *     .vscode/
 *       settings.json          (Logic Apps Standard extension settings)
 *       extensions.json        (recommended extensions)
 *     {WorkflowName}/
 *       workflow.json
 *       workflow-designtime/   (empty — VS Code designer populates this on first open)
 *     Artifacts/
 *       Maps/
 *         {MapName}.xslt
 *         {MapName}.lml
 *       Rules/                 (placeholder for migrated BRE .xml rule policies)
 *       Schemas/
 *         {SchemaName}.xsd
 *     lib/                     (local NuGet packages / DLL references for code functions)
 *     {FunctionName}.cs        (local code function stubs)
 *     .funcignore              (Azure Functions deploy exclusions)
 *     .gitignore               (standard Logic Apps Standard .gitignore)
 *     connections.json
 *     host.json
 *     local.settings.json
 *     arm-template.json        (if infrastructure included)
 *     arm-parameters.json      (if infrastructure included)
 *     tests/
 *       {WorkflowName}.tests.json
 *     {AppName}.code-workspace
 *     migration-report.md
 *     migration-report.html    (browser-ready, print to PDF via Ctrl+P)
 */

import { mkdirSync, writeFileSync, existsSync, copyFileSync } from 'fs';
import { join, basename } from 'path';
import type { BuildResult } from '../stage3-build/package-builder.js';
import { migrationReportToHtml } from './markdown-to-html.js';

export interface WriteOptions {
  /** The directory to write all output files to */
  outputDir: string;
  /** The fully generated BuildResult from the scaffold step */
  buildResult: BuildResult;
  /** The markdown migration report */
  migrationReport: string;
}

export function writeOutput(options: WriteOptions): void {
  const { outputDir, buildResult, migrationReport } = options;

  ensureDir(outputDir);

  // ── Workflows ───────────────────────────────────────────────────────────────
  for (const wf of buildResult.project.workflows) {
    const wfDir = join(outputDir, wf.name);
    ensureDir(wfDir);
    writeJson(join(wfDir, 'workflow.json'), wf.workflow);
    // workflow-designtime/ is populated by the VS Code Logic Apps extension on first open.
    // Creating the directory here ensures the project structure matches the reference template.
    ensureDir(join(wfDir, 'workflow-designtime'));
  }

  // ── Root project files ──────────────────────────────────────────────────────
  writeJson(join(outputDir, 'connections.json'), buildResult.project.connections);
  writeJson(join(outputDir, 'host.json'), buildResult.project.host);
  writeJson(join(outputDir, 'local.settings.json'), buildResult.localSettings);

  // ── Maps ────────────────────────────────────────────────────────────────────
  const hasXslt = Object.keys(buildResult.project.xsltMaps).length > 0;
  const hasLml  = Object.keys(buildResult.project.lmlMaps).length > 0;

  if (hasXslt || hasLml) {
    const mapsDir = join(outputDir, 'Artifacts', 'Maps');
    ensureDir(mapsDir);
    for (const [name, content] of Object.entries(buildResult.project.xsltMaps)) {
      writeFileSync(join(mapsDir, name), content, 'utf-8');
    }
    for (const [name, content] of Object.entries(buildResult.project.lmlMaps)) {
      writeFileSync(join(mapsDir, name), content, 'utf-8');
    }
  }

  // ── ARM Infrastructure ──────────────────────────────────────────────────────
  if (buildResult.armTemplate && Object.keys(buildResult.armTemplate).length > 0) {
    writeJson(join(outputDir, 'arm-template.json'), buildResult.armTemplate);
    writeJson(join(outputDir, 'arm-parameters.json'), buildResult.armParameters);
  }

  // ── Test specs ──────────────────────────────────────────────────────────────
  if (buildResult.testSpecs && Object.keys(buildResult.testSpecs).length > 0) {
    const testsDir = join(outputDir, 'tests');
    ensureDir(testsDir);
    for (const [name, content] of Object.entries(buildResult.testSpecs)) {
      writeFileSync(join(testsDir, name), String(content), 'utf-8');
    }
  }

  // ── XSD Schemas ─────────────────────────────────────────────────────────────
  if (buildResult.schemaFiles && buildResult.schemaFiles.length > 0) {
    const schemasDir = join(outputDir, 'Artifacts', 'Schemas');
    ensureDir(schemasDir);
    for (const schemaPath of buildResult.schemaFiles) {
      try {
        copyFileSync(schemaPath, join(schemasDir, basename(schemaPath)));
      } catch {
        // Non-fatal: schema file may have moved since artifact scan
      }
    }
  }

  // ── Artifacts/Rules/ — placeholder for migrated BRE rule policies ───────────
  ensureDir(join(outputDir, 'Artifacts', 'Rules'));

  // ── lib/ — local NuGet packages / DLL references for code functions ──────────
  ensureDir(join(outputDir, 'lib'));

  // ── .funcignore — Azure Functions deployment exclusions ──────────────────────
  writeFileSync(join(outputDir, '.funcignore'), FUNCIGNORE_CONTENT, 'utf-8');

  // ── .gitignore ────────────────────────────────────────────────────────────────
  writeFileSync(join(outputDir, '.gitignore'), GITIGNORE_CONTENT, 'utf-8');

  // ── Local code function stubs ────────────────────────────────────────────────
  if (buildResult.localCodeFunctions && Object.keys(buildResult.localCodeFunctions).length > 0) {
    for (const [name, content] of Object.entries(buildResult.localCodeFunctions)) {
      writeFileSync(join(outputDir, name), content, 'utf-8');
    }
  }

  // ── .vscode/ settings ────────────────────────────────────────────────────────
  const vscodeDir = join(outputDir, '.vscode');
  ensureDir(vscodeDir);
  writeJson(join(vscodeDir, 'settings.json'), {
    'azureFunctions.deploySubpath':                        '.',
    'azureFunctions.suppressProject':                      true,
    'azureLogicAppsStandard.autoRuntimeDependenciesValidation': true,
    'azureLogicAppsStandard.showAutoTriggerKey':            true,
    'azureFunctions.projectLanguage':                      'Custom',
  });
  writeJson(join(vscodeDir, 'extensions.json'), {
    recommendations: ['ms-azuretools.vscode-azurelogicapps'],
  });

  // ── VS Code workspace file ───────────────────────────────────────────────────
  const appName = buildResult.project.appName;
  const workspace = {
    folders: [{ path: '.' }],
    settings: {
      'azureLogicAppsStandard.showAutoTriggerKey': true,
    },
  };
  writeJson(join(outputDir, `${appName}.code-workspace`), workspace);

  // ── Migration report ────────────────────────────────────────────────────────
  writeFileSync(join(outputDir, 'migration-report.md'), migrationReport, 'utf-8');
  writeFileSync(
    join(outputDir, 'migration-report.html'),
    migrationReportToHtml(migrationReport, buildResult.project.appName),
    'utf-8'
  );
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ensureDir(dir: string): void {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
}

function writeJson(filePath: string, data: unknown): void {
  writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

// ─── Static file templates ─────────────────────────────────────────────────────

const FUNCIGNORE_CONTENT = `\
.debug
.vscode
local.settings.json
tests/
migration-report.md
migration-report.html
*.code-workspace
`;

const GITIGNORE_CONTENT = `\
bin/
obj/
.vs/
local.settings.json
workflow-designtime/
.debug/
`;

