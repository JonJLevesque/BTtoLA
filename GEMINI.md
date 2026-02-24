# BizTalk to Logic Apps — Project Context

> Project conventions and development guide for Google Gemini Code Assist.
> Migration domain knowledge (shape mappings, adapter tables, WDL rules) is proprietary
> and lives on the proxy server — not in this file.

---

## What This Project Does

Commercial TypeScript tool that migrates BizTalk Server applications to Azure Logic Apps Standard.
Consultants point it at a folder of BizTalk artifacts (.odx, .btm, .btp, BindingInfo.xml) and get
back a deployable Logic Apps project + migration report.

**BizTalk extended support ends October 2028** — this tool exists to serve that migration window.

---

## Three-Stage Architecture

```
Stage 1 (UNDERSTAND)  src/stage1-understand/   Parse BizTalk XML → structured metadata
Stage 2 (DOCUMENT)    src/stage2-document/     Gap analysis, architecture recommendation
Stage 3 (BUILD)       src/stage3-build/        Generate Logic Apps JSON artifacts
```

Both stages converge on the `IntegrationIntent` interface (`src/shared/integration-intent.ts`).

The pipeline is also exposed as:
- **CLI**: `biztalk-migrate run --dir ./artifacts --app "MyApp" --output ./output`
- **VS Code command**: "BizTalk: Run Migration"
- **GitHub Action**: `.github/workflows/biztalk-migrate.yml`

The `runMigration()` engine lives in `src/runner/migration-runner.ts`.

---

## Project Structure

```
src/
  shared/              IntegrationIntent type, intent-validator, shared interfaces
  stage1-understand/   7 files: orchestration/map/pipeline/binding analyzers,
                       complexity scorer, pattern detector, intent constructor
  stage2-document/     5 files: gap analyzer, risk assessor, architecture recommender,
                       migration spec generator, migration result generator
  stage3-build/        7 files: workflow/map/connection/infra/test generators,
                       package builder, index
  greenfield/          7 files: NLP interpreter, schema inferrer, connector recommender,
                       design generator, template library, refinement engine, index
  runner/              6 files: migration-runner, claude-client, report-generator,
                       output-writer, types, index
  licensing/           License validation and feature gating
  mcp-server/          MCP server + 34 tools + 8 resources + prompts
  cli/                 CLI entry point (commander)
  vscode/              VS Code extension + webview panels (analysis-results, template-browser)
schemas/               3 machine-readable schema files (IntegrationIntent, BizTalkApplication, etc.)
docs/reference/        8 reference documents (source of truth — DO NOT modify without review)
tests/
  unit/                10 unit test suites
  integration/         1 integration test suite (pipeline.test.ts — 50 tests)
  golden-master/       Comparison engine + golden-master tests
  regression/          Quality baseline + regression runner + snapshots
  fixtures/            3 fixture sets (01-map-scripting, 02-simple-file-receive, 03-cbr)
```

---

## Build and Test

```bash
# Type check — must pass with zero errors before committing
npx tsc --noEmit

# Run all tests (202 tests, 14 suites)
npm test

# Run a specific suite
npx vitest run tests/unit/orchestration-analyzer.test.ts

# Run integration tests
npx vitest run tests/integration/pipeline.test.ts

# Build
npm run build

# Run CLI (dev mode — no API calls)
BTLA_DEV_MODE=true node dist/cli/index.js run \
  --dir tests/fixtures/02-simple-file-receive \
  --app "SimpleFileReceive" \
  --output /tmp/test-output
```

---

## TypeScript Conventions

- **`strict: true`** + **`exactOptionalPropertyTypes: true`** — both enforced
- For optional properties use conditional spread: `...(val !== undefined ? { prop: val } : {})`
- All imports use `.js` extension (ESM, Node 20): `import { foo } from './bar.js'`
- No `any` without `eslint-disable` comment explaining why
- Types live in `src/types/` (domain types) or inline in the module that owns them
- Test files import from source directly, never from `dist/`

---

## Key Types

```typescript
// src/shared/integration-intent.ts
IntegrationIntent      // The central exchange format between Stage 1 and Stage 3

// src/types/biztalk.ts
BizTalkApplication     // Stage 1 output: parsed orchestrations, maps, pipelines, bindings

// src/types/logicapps.ts
WorkflowJson           // { definition: WorkflowDefinition, kind: 'Stateful' | 'Stateless' }
LogicAppsProject       // Full package: workflows[], connections, host, settings, maps

// src/types/migration.ts
MigrationGap           // { capability, severity, mitigation, ... }
MigrationResult        // Stage 2/3 output with spec + artifacts

// src/runner/types.ts
MigrationRunOptions    // Input to runMigration()
MigrationRunResult     // Output: { success, buildResult, qualityReport, migrationReport, ... }
```

---

## Environment Variables

```
BTLA_DEV_MODE=true         Offline mode — skips all API calls, instant responses
ANTHROPIC_API_KEY=sk-...   Direct Anthropic API (bypasses proxy, dev use only)
BTLA_LICENSE_KEY=...        Tool license key — proxy mode (production)
BTLA_PROXY_URL=...          Override proxy URL (default: https://api.biztalk-migrate.com/v1)
```

---

## License Tiers

```
Free      Stage 1 + Stage 2 only (analyze + document, no code generation)
Standard  Full pipeline + deployment tools
Premium   Standard + NLP Greenfield Builder + template library + schema inference
```

Feature gating is in `src/licensing/index.ts` via `isFeatureAvailable(feature, tier)`.

---

## MCP Server

The MCP server (`src/mcp-server/server.ts`) exposes 34 tools over stdio transport.
Start it with: `node dist/mcp-server/server.js`

Configure in Claude Desktop (`~/.claude/claude_desktop_config.json`) or VS Code (`.vscode/mcp.json`).

---

## Support

Email: Me@Jonlevesque.com
