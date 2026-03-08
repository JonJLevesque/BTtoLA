/**
 * Output Writer — Write BuildResult + migration-report to disk
 *
 * Produces a Logic Apps Standard project matching the reference template:
 *
 *   {outputDir}/
 *     {AppName}.code-workspace         references LA project + Functions project
 *     migration-report.md / .html      migration-specific output at root
 *     {AppName}/                       ← Logic Apps Standard project
 *       .funcignore
 *       .gitignore
 *       .vscode/
 *         extensions.json
 *         launch.json                  debug config (custom code runtime)
 *         settings.json
 *         tasks.json                   generateDebugSymbols + func host start
 *       Artifacts/
 *         Maps/   {name}.xslt / .lml
 *         Rules/  (placeholder for migrated BRE rule policies)
 *         Schemas/ {name}.xsd
 *       lib/
 *         custom/
 *           net472/
 *             extensions.json          {"extensions":[]}
 *           {FunctionName}/
 *             function.json            binding descriptor per local code function
 *       workflow-designtime/           at LA project ROOT — VS Code designer files
 *         host.json
 *         local.settings.json
 *       {WorkflowName}/
 *         workflow.json
 *       connections.json
 *       host.json
 *       local.settings.json
 *       arm-template.json / arm-parameters.json (if infrastructure included)
 *       tests/ {WorkflowName}.tests.json
 *     {AppName}-Functions/             ← C# project (only if local code functions)
 *       {FunctionName}.cs
 *       {AppName}-Functions.csproj
 *       .vscode/
 *         extensions.json
 *         settings.json
 *         tasks.json
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
  const appName = buildResult.project.appName;

  ensureDir(outputDir);

  // ── Logic Apps Standard project directory ─────────────────────────────────
  const laDir = join(outputDir, appName);
  ensureDir(laDir);

  // ── Workflows ──────────────────────────────────────────────────────────────
  for (const wf of buildResult.project.workflows) {
    const wfDir = join(laDir, wf.name);
    ensureDir(wfDir);
    writeJson(join(wfDir, 'workflow.json'), wf.workflow);
  }

  // ── Root LA project files ──────────────────────────────────────────────────
  writeJson(join(laDir, 'connections.json'), buildResult.project.connections);
  writeJson(join(laDir, 'host.json'), buildResult.project.host);
  writeJson(join(laDir, 'local.settings.json'), buildResult.localSettings);

  // ── Maps ───────────────────────────────────────────────────────────────────
  const hasXslt = Object.keys(buildResult.project.xsltMaps).length > 0;
  const hasLml  = Object.keys(buildResult.project.lmlMaps).length > 0;
  if (hasXslt || hasLml) {
    const mapsDir = join(laDir, 'Artifacts', 'Maps');
    ensureDir(mapsDir);
    for (const [name, content] of Object.entries(buildResult.project.xsltMaps)) {
      writeFileSync(join(mapsDir, name), content, 'utf-8');
    }
    for (const [name, content] of Object.entries(buildResult.project.lmlMaps)) {
      writeFileSync(join(mapsDir, name), content, 'utf-8');
    }
  }

  // Artifacts/Rules — placeholder for migrated BRE rule policies
  ensureDir(join(laDir, 'Artifacts', 'Rules'));

  // ── XSD Schemas ───────────────────────────────────────────────────────────
  if (buildResult.schemaFiles && buildResult.schemaFiles.length > 0) {
    const schemasDir = join(laDir, 'Artifacts', 'Schemas');
    ensureDir(schemasDir);
    for (const schemaPath of buildResult.schemaFiles) {
      try {
        copyFileSync(schemaPath, join(schemasDir, basename(schemaPath)));
      } catch {
        // Non-fatal: schema file may have moved since artifact scan
      }
    }
  }

  // ── workflow-designtime — at LA project ROOT (NOT inside workflow dirs) ────
  // This directory is required by the VS Code Logic Apps Standard extension for
  // the workflow designer to function. It has its own host.json + local.settings.json
  // with the WorkflowOperationDiscoveryHostMode flag.
  const wdDir = join(laDir, 'workflow-designtime');
  ensureDir(wdDir);
  writeJson(join(wdDir, 'host.json'), WORKFLOW_DESIGNTIME_HOST);
  writeJson(join(wdDir, 'local.settings.json'), WORKFLOW_DESIGNTIME_LOCAL_SETTINGS);

  // ── lib/custom structure ───────────────────────────────────────────────────
  // lib/custom/net472/ holds compiled DLL output from the -Functions C# project.
  // extensions.json is the Azure Functions extension manifest (starts empty).
  const net472Dir = join(laDir, 'lib', 'custom', 'net472');
  ensureDir(net472Dir);
  writeJson(join(net472Dir, 'extensions.json'), { extensions: [] });

  // ── Local code functions + C# project ─────────────────────────────────────
  const localFunctions = buildResult.localCodeFunctions ?? {};
  const functionFileNames = Object.keys(localFunctions).filter(k => k.endsWith('.cs'));
  const functionNames = functionFileNames.map(k => k.replace(/\.cs$/, ''));

  if (functionNames.length > 0) {
    const functionsProjectName = `${appName}-Functions`;
    const functionsDir = join(outputDir, functionsProjectName);
    ensureDir(functionsDir);

    // .cs stubs in C# project
    for (const [fileName, content] of Object.entries(localFunctions)) {
      if (fileName.endsWith('.cs')) {
        writeFileSync(join(functionsDir, fileName), content, 'utf-8');
      }
    }

    // .csproj — references back to the LA project folder via <LogicAppFolder>
    writeFileSync(
      join(functionsDir, `${functionsProjectName}.csproj`),
      generateCsproj(appName),
      'utf-8',
    );

    // .vscode for the C# project
    const fvsDir = join(functionsDir, '.vscode');
    ensureDir(fvsDir);
    writeJson(join(fvsDir, 'extensions.json'), {
      recommendations: ['ms-azuretools.vscode-azurelogicapps'],
    });
    writeJson(join(fvsDir, 'settings.json'), FUNCTIONS_VSCODE_SETTINGS);
    writeJson(join(fvsDir, 'tasks.json'), FUNCTIONS_VSCODE_TASKS);

    // lib/custom/{functionName}/function.json — Azure Functions binding descriptor
    for (const functionName of functionNames) {
      const fnDescDir = join(laDir, 'lib', 'custom', functionName);
      ensureDir(fnDescDir);
      writeJson(join(fnDescDir, 'function.json'), generateFunctionJson(functionsProjectName, functionName));
    }
  }

  // ── ARM Infrastructure ─────────────────────────────────────────────────────
  if (buildResult.armTemplate && Object.keys(buildResult.armTemplate).length > 0) {
    writeJson(join(laDir, 'arm-template.json'), buildResult.armTemplate);
    writeJson(join(laDir, 'arm-parameters.json'), buildResult.armParameters);
  }

  // ── Test specs ─────────────────────────────────────────────────────────────
  if (buildResult.testSpecs && Object.keys(buildResult.testSpecs).length > 0) {
    const testsDir = join(laDir, 'tests');
    ensureDir(testsDir);
    for (const [name, content] of Object.entries(buildResult.testSpecs)) {
      writeFileSync(join(testsDir, name), String(content), 'utf-8');
    }
  }

  // ── .vscode/ in LA project ─────────────────────────────────────────────────
  const vscodeDir = join(laDir, '.vscode');
  ensureDir(vscodeDir);
  writeJson(join(vscodeDir, 'extensions.json'), {
    recommendations: ['ms-azuretools.vscode-azurelogicapps'],
  });
  writeJson(join(vscodeDir, 'settings.json'), generateVscodeSettings());
  writeJson(join(vscodeDir, 'launch.json'), generateLaunchJson(appName, functionNames.length > 0));
  writeJson(join(vscodeDir, 'tasks.json'), VSCODE_TASKS);

  // ── .funcignore and .gitignore ─────────────────────────────────────────────
  writeFileSync(join(laDir, '.funcignore'), FUNCIGNORE_CONTENT, 'utf-8');
  writeFileSync(join(laDir, '.gitignore'), GITIGNORE_CONTENT, 'utf-8');

  // ── code-workspace (at outputDir root, references both projects) ────────────
  const workspaceFolders: Array<{ name: string; path: string }> = [
    { name: appName, path: `./${appName}` },
  ];
  if (functionNames.length > 0) {
    workspaceFolders.push({
      name: `${appName}-Functions`,
      path: `./${appName}-Functions`,
    });
  }
  writeJson(join(outputDir, `${appName}.code-workspace`), {
    folders: workspaceFolders,
    settings: {
      'azureLogicAppsStandard.showAutoTriggerKey': true,
    },
  });

  // ── Migration report (at outputDir root) ──────────────────────────────────
  writeFileSync(join(outputDir, 'migration-report.md'), migrationReport, 'utf-8');
  writeFileSync(
    join(outputDir, 'migration-report.html'),
    migrationReportToHtml(migrationReport, appName),
    'utf-8',
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

// ─── workflow-designtime content ───────────────────────────────────────────────
// Required by the VS Code Logic Apps Standard extension for the workflow designer.

const WORKFLOW_DESIGNTIME_HOST = {
  version: '2.0',
  extensionBundle: {
    id: 'Microsoft.Azure.Functions.ExtensionBundle.Workflows',
    version: '[1.*, 2.0.0)',
  },
  extensions: {
    workflow: {
      settings: {
        'Runtime.WorkflowOperationDiscoveryHostMode': 'true',
      },
    },
  },
};

const WORKFLOW_DESIGNTIME_LOCAL_SETTINGS = {
  IsEncrypted: false,
  Values: {
    APP_KIND: 'workflowapp',
    FUNCTIONS_WORKER_RUNTIME: 'node',
    AzureWebJobsSecretStorageType: 'Files',
  },
};

// ─── .vscode generators ────────────────────────────────────────────────────────

function generateVscodeSettings(): Record<string, unknown> {
  return {
    'azureLogicAppsStandard.projectLanguage':   'JavaScript',
    'azureLogicAppsStandard.projectRuntime':    '~4',
    'debug.internalConsoleOptions':             'neverOpen',
    'azureFunctions.suppressProject':            true,
  };
}

function generateLaunchJson(appName: string, hasCustomCode: boolean): Record<string, unknown> {
  return {
    version: '0.2.0',
    configurations: [
      {
        name: `Run/Debug logic app${hasCustomCode ? ' with local function ' + appName : ' ' + appName}`,
        type: 'logicapp',
        request: 'launch',
        ...(hasCustomCode ? { funcRuntime: 'coreclr', customCodeRuntime: 'clr' } : {}),
      },
    ],
  };
}

const VSCODE_TASKS = {
  version: '2.0.0',
  tasks: [
    {
      label: 'generateDebugSymbols',
      command: '${config:azureLogicAppsStandard.dotnetBinaryPath}',
      args: ['${input:getDebugSymbolDll}'],
      type: 'process',
      problemMatcher: '$msCompile',
    },
    {
      type: 'shell',
      command: '${config:azureLogicAppsStandard.funcCoreToolsBinaryPath}',
      args: ['host', 'start'],
      options: {
        env: {
          PATH: '${config:azureLogicAppsStandard.autoRuntimeDependenciesPath}\\NodeJs;${config:azureLogicAppsStandard.autoRuntimeDependenciesPath}\\DotNetSDK;$env:PATH',
        },
      },
      problemMatcher: '$func-watch',
      isBackground: true,
      label: 'func: host start',
      group: { kind: 'build', isDefault: true },
    },
  ],
  inputs: [
    {
      id: 'getDebugSymbolDll',
      type: 'command',
      command: 'azureLogicAppsStandard.getDebugSymbolDll',
    },
  ],
};

const FUNCTIONS_VSCODE_SETTINGS: Record<string, unknown> = {
  'azureFunctions.deploySubpath':   '.',
  'azureFunctions.suppressProject': false,
};

const FUNCTIONS_VSCODE_TASKS = {
  version: '2.0.0',
  tasks: [
    {
      label: 'build',
      command: 'dotnet',
      type: 'process',
      args: ['build', '${workspaceFolder}'],
      group: { kind: 'build', isDefault: true },
      problemMatcher: '$msCompile',
    },
  ],
};

// ─── C# project generator ─────────────────────────────────────────────────────

function generateCsproj(logicAppFolderName: string): string {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <IsPackable>false</IsPackable>
    <TargetFramework>net472</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Library</OutputType>
    <PlatformTarget>x64</PlatformTarget>
    <LogicAppFolder>${logicAppFolderName}</LogicAppFolder>
    <CopyToOutputDirectory>Always</CopyToOutputDirectory>
  </PropertyGroup>

  <ItemGroup>
    <PackageReference Include="Microsoft.Azure.WebJobs.Core" Version="3.0.39" />
    <PackageReference Include="Microsoft.Azure.Workflows.WebJobs.Sdk" Version="1.1.0" />
    <PackageReference Include="Microsoft.NET.Sdk.Functions" Version="4.2.0" />
    <PackageReference Include="Microsoft.Extensions.Logging.Abstractions" Version="2.1.1" />
    <PackageReference Include="Microsoft.Extensions.Logging" Version="2.1.1" />
  </ItemGroup>

  <Target Name="CleanCustomLib" AfterTargets="Compile">
    <ItemGroup>
      <DirsToClean Include="..\\$(LogicAppFolder)\\lib\\custom" />
    </ItemGroup>
    <RemoveDir Directories="@(DirsToClean)" />
  </Target>

  <Target Name="CopyExtensionFiles" AfterTargets="ParameterizedFunctionJsonGenerator">
    <ItemGroup>
      <CopyFiles Include="$(MSBuildProjectDirectory)\\bin\\$(Configuration)\\net472\\**\\*.*"
                 Exclude="$(MSBuildProjectDirectory)\\bin\\$(Configuration)\\net472\\*.*" />
      <CopyFiles2 Include="$(MSBuildProjectDirectory)\\bin\\$(Configuration)\\net472\\*.*" />
    </ItemGroup>
    <Copy SourceFiles="@(CopyFiles)"
          DestinationFolder="..\\$(LogicAppFolder)\\lib\\custom\\%(RecursiveDir)"
          SkipUnchangedFiles="true" />
    <Copy SourceFiles="@(CopyFiles2)"
          DestinationFolder="..\\$(LogicAppFolder)\\lib\\custom\\net472\\"
          SkipUnchangedFiles="true" />
    <ItemGroup>
      <MoveFiles Include="..\\$(LogicAppFolder)\\lib\\custom\\bin\\*.*" />
    </ItemGroup>
    <Move SourceFiles="@(MoveFiles)"
          DestinationFolder="..\\$(LogicAppFolder)\\lib\\custom\\net472" />
    <ItemGroup>
      <DirsToClean2 Include="..\\$(LogicAppFolder)\\lib\\custom\\bin" />
    </ItemGroup>
    <RemoveDir Directories="@(DirsToClean2)" />
  </Target>

  <ItemGroup>
    <Reference Include="Microsoft.CSharp" />
  </ItemGroup>
</Project>
`;
}

// ─── function.json binding descriptor ────────────────────────────────────────

function generateFunctionJson(namespace: string, functionName: string): Record<string, unknown> {
  return {
    Name: null,
    ScriptFile: `../bin/${functionName}.dll`,
    FunctionDirectory: null,
    EntryPoint: `${namespace}.${functionName}.Run`,
    Language: 'net472',
    Properties: {},
    Bindings: [
      {
        Name: 'body',
        Connection: null,
        Type: 'workflowActionTrigger',
        Properties: {},
        Direction: 'In',
        DataType: null,
        IsTrigger: true,
        IsReturn: false,
      },
    ],
    InputBindings: [
      {
        Name: 'body',
        Connection: null,
        Type: 'workflowActionTrigger',
        Properties: {},
        Direction: 'In',
        DataType: null,
        IsTrigger: true,
        IsReturn: false,
      },
    ],
    OutputBindings: [],
  };
}

// ─── Static file templates ─────────────────────────────────────────────────────

const FUNCIGNORE_CONTENT = `\
.debug
.git*
.vscode
__azurite_db*__.json
__blobstorage__
__queuestorage__
global.json
local.settings.json
*-Functions
workflow-designtime/
`;

const GITIGNORE_CONTENT = `\
# Azure logic apps artifacts
bin
obj
appsettings.json
local.settings.json
__blobstorage__
.debug
__queuestorage__
__azurite_db*__.json

# Added folders and file patterns
workflow-designtime/
*.code-workspace
`;
