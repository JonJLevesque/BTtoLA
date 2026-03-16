/**
 * Output Writer — Write BuildResult + migration-report to disk
 *
 * Produces a Logic Apps Standard project matching the reference template.
 * The output directory IS the Logic Apps project root (flat structure).
 * If local code functions are present, the C# project lives in a sibling subfolder.
 *
 *   {outputDir}/                       ← Logic Apps Standard project root
 *     .funcignore
 *     .gitignore
 *     .vscode/
 *       extensions.json
 *       launch.json                    debug config (supports custom code runtime)
 *       settings.json
 *       tasks.json                     generateDebugSymbols + func host start
 *     Artifacts/
 *       Maps/   {name}.xslt / .lml
 *       Rules/  (placeholder for migrated BRE rule policies)
 *       Schemas/ {name}.xsd
 *     lib/
 *       custom/
 *         net472/
 *           extensions.json            {"extensions":[]}
 *         {FunctionName}/
 *           function.json              binding descriptor per local code function
 *     workflow-designtime/             required by VS Code Logic Apps extension for designer
 *       host.json
 *       local.settings.json
 *     {WorkflowName}/
 *       workflow.json
 *     {AppName}-Functions/             C# project (only if local code functions exist)
 *       {FunctionName}.cs
 *       {AppName}-Functions.csproj
 *       .vscode/
 *     connections.json
 *     host.json
 *     local.settings.json
 *     parameters.json                 {} (workflow parameters, always present)
 *     {AppName}.code-workspace         single-root workspace (+ Functions folder if needed)
 *     arm-template.json / arm-parameters.json (if infrastructure included)
 *     tests/ {WorkflowName}.tests.json
 *     migration-report.md / .html
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

  // ── Workflows ──────────────────────────────────────────────────────────────
  for (const wf of buildResult.project.workflows) {
    const wfDir = join(outputDir, wf.name);
    ensureDir(wfDir);
    writeJson(join(wfDir, 'workflow.json'), wf.workflow);
  }

  // ── Root project files ─────────────────────────────────────────────────────
  writeJson(join(outputDir, 'connections.json'), buildResult.project.connections);
  writeJson(join(outputDir, 'host.json'), buildResult.project.host);
  writeJson(join(outputDir, 'local.settings.json'), buildResult.localSettings);
  // Logic Apps workflow parameters file (always present, even if empty)
  writeJson(join(outputDir, 'parameters.json'), {});

  // ── Artifacts — always created (Maps, Rules, Schemas always present) ────────
  const mapsDir    = join(outputDir, 'Artifacts', 'Maps');
  const rulesDir   = join(outputDir, 'Artifacts', 'Rules');
  const schemasDir = join(outputDir, 'Artifacts', 'Schemas');
  ensureDir(mapsDir);
  ensureDir(rulesDir);
  ensureDir(schemasDir);

  for (const [name, content] of Object.entries(buildResult.project.xsltMaps)) {
    writeFileSync(join(mapsDir, name), content, 'utf-8');
  }
  for (const [name, content] of Object.entries(buildResult.project.lmlMaps)) {
    writeFileSync(join(mapsDir, name), content, 'utf-8');
  }

  if (buildResult.schemaFiles && buildResult.schemaFiles.length > 0) {
    for (const schemaPath of buildResult.schemaFiles) {
      try {
        copyFileSync(schemaPath, join(schemasDir, basename(schemaPath)));
      } catch {
        // Non-fatal: schema file may have moved since artifact scan
      }
    }
  }

  // ── workflow-designtime — at project ROOT ──────────────────────────────────
  // Required by the VS Code Logic Apps Standard extension for the workflow
  // designer. Must have its own host.json + local.settings.json.
  const wdDir = join(outputDir, 'workflow-designtime');
  ensureDir(wdDir);
  writeJson(join(wdDir, 'host.json'), WORKFLOW_DESIGNTIME_HOST);
  writeJson(join(wdDir, 'local.settings.json'), WORKFLOW_DESIGNTIME_LOCAL_SETTINGS);

  // ── lib/custom structure ───────────────────────────────────────────────────
  const net472Dir = join(outputDir, 'lib', 'custom', 'net472');
  ensureDir(net472Dir);
  writeJson(join(net472Dir, 'extensions.json'), { extensions: [] });

  // FIX-1: builtinOperationSdks placeholder dirs — Logic Apps Standard runtime expects these
  ensureDir(join(outputDir, 'lib', 'builtinOperationSdks', 'JAR'));
  ensureDir(join(outputDir, 'lib', 'builtinOperationSdks', 'net472'));

  // ── Local code functions → sibling C# project ─────────────────────────────
  const localFunctions = buildResult.localCodeFunctions ?? {};
  const functionFileNames = Object.keys(localFunctions).filter(k => k.endsWith('.cs'));
  const functionNames = functionFileNames.map(k => k.replace(/\.cs$/, ''));

  if (functionNames.length > 0) {
    const functionsProjectName = `${appName}-Functions`;
    // FIX-9: Namespace must match the C# stubs (package-builder uses appName + 'Functions')
    const functionsNamespace = appName.replace(/[^A-Za-z0-9]/g, '') + 'Functions';
    const functionsDir = join(outputDir, functionsProjectName);
    ensureDir(functionsDir);

    // .cs stubs
    for (const [fileName, content] of Object.entries(localFunctions)) {
      if (fileName.endsWith('.cs')) {
        writeFileSync(join(functionsDir, fileName), content, 'utf-8');
      }
    }

    // .csproj — <LogicAppFolder> points to parent (the LA project root)
    writeFileSync(
      join(functionsDir, `${functionsProjectName}.csproj`),
      generateCsproj('..'),
      'utf-8',
    );

    // FIX-13: .sln file — needed for Visual Studio to open the project correctly
    writeFileSync(
      join(functionsDir, `${functionsProjectName}.sln`),
      generateSolutionFile(functionsProjectName),
      'utf-8',
    );

    // .vscode for the C# project — matches reference (Empty_Function/.vscode/)
    const fvsDir = join(functionsDir, '.vscode');
    ensureDir(fvsDir);
    writeJson(join(fvsDir, 'extensions.json'), FUNCTIONS_VSCODE_EXTENSIONS);
    writeJson(join(fvsDir, 'settings.json'), FUNCTIONS_VSCODE_SETTINGS);
    writeJson(join(fvsDir, 'tasks.json'), FUNCTIONS_VSCODE_TASKS);

    // lib/custom/{functionName}/function.json — binding descriptor
    // FIX-2: Use the same namespace as C# stubs; add InputSchema + Trigger blocks
    for (const functionName of functionNames) {
      const fnDescDir = join(outputDir, 'lib', 'custom', functionName);
      ensureDir(fnDescDir);
      writeJson(
        join(fnDescDir, 'function.json'),
        generateFunctionJson(functionsNamespace, functionName),
      );
    }
  }

  // ── ARM Infrastructure ─────────────────────────────────────────────────────
  if (buildResult.armTemplate && Object.keys(buildResult.armTemplate).length > 0) {
    writeJson(join(outputDir, 'arm-template.json'), buildResult.armTemplate);
    writeJson(join(outputDir, 'arm-parameters.json'), buildResult.armParameters);
  }

  // ── Test specs ─────────────────────────────────────────────────────────────
  if (buildResult.testSpecs && Object.keys(buildResult.testSpecs).length > 0) {
    const testsDir = join(outputDir, 'tests');
    ensureDir(testsDir);
    for (const [name, content] of Object.entries(buildResult.testSpecs)) {
      writeFileSync(join(testsDir, name), String(content), 'utf-8');
    }
  }

  // ── .vscode/ ───────────────────────────────────────────────────────────────
  const vscodeDir = join(outputDir, '.vscode');
  ensureDir(vscodeDir);
  writeJson(join(vscodeDir, 'extensions.json'), {
    recommendations: ['ms-azuretools.vscode-azurelogicapps'],
  });
  writeJson(join(vscodeDir, 'settings.json'), generateVscodeSettings());
  writeJson(join(vscodeDir, 'launch.json'), generateLaunchJson(appName, functionNames.length > 0));
  writeJson(join(vscodeDir, 'tasks.json'), VSCODE_TASKS);

  // ── .funcignore / .gitignore ───────────────────────────────────────────────
  writeFileSync(join(outputDir, '.funcignore'), FUNCIGNORE_CONTENT, 'utf-8');
  writeFileSync(join(outputDir, '.gitignore'), GITIGNORE_CONTENT, 'utf-8');

  // ── code-workspace ─────────────────────────────────────────────────────────
  // Single-root when no functions; multi-root when C# functions project exists.
  const workspaceFolders: Array<{ name: string; path: string }> = [
    { name: appName, path: '.' },
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

  // ── Migration report ───────────────────────────────────────────────────────
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

// ─── workflow-designtime ───────────────────────────────────────────────────────

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
    'azureLogicAppsStandard.projectLanguage': 'JavaScript',
    'azureLogicAppsStandard.projectRuntime':  '~4',
    'debug.internalConsoleOptions':           'neverOpen',
    'azureFunctions.suppressProject':          true,
  };
}

function generateLaunchJson(appName: string, hasCustomCode: boolean): Record<string, unknown> {
  return {
    version: '0.2.0',
    configurations: [
      {
        name: hasCustomCode
          ? `Run/Debug logic app with local function ${appName}`
          : `Run/Debug ${appName}`,
        type: 'logicapp',
        request: 'launch',
        isCodeless: true,
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

const FUNCTIONS_VSCODE_EXTENSIONS = {
  recommendations: [
    'ms-azuretools.vscode-azurefunctions',
    'ms-dotnettools.csharp',
  ],
};

const FUNCTIONS_VSCODE_SETTINGS: Record<string, unknown> = {
  'azureFunctions.deploySubpath':              'bin/Release/net472/publish',
  'azureFunctions.projectLanguage':            'C#',
  'azureFunctions.projectRuntime':             '~4',
  'debug.internalConsoleOptions':              'neverOpen',
  'azureFunctions.preDeployTask':              'publish (functions)',
  'azureFunctions.templateFilter':             'Core',
  'azureFunctions.showTargetFrameworkWarning': false,
  'azureFunctions.projectSubpath':             'bin\\Release\\net472\\publish',
};

const FUNCTIONS_VSCODE_TASKS = {
  version: '2.0.0',
  tasks: [
    {
      label: 'build',
      command: '${config:azureLogicAppsStandard.dotnetBinaryPath}',
      type: 'process',
      args: ['build', '${workspaceFolder}'],
      group: { kind: 'build', isDefault: true },
    },
  ],
};

// ─── C# project generators ────────────────────────────────────────────────────

function generateCsproj(logicAppRelativePath: string): string {
  return `<Project Sdk="Microsoft.NET.Sdk">
  <PropertyGroup>
    <IsPackable>false</IsPackable>
    <TargetFramework>net472</TargetFramework>
    <AzureFunctionsVersion>v4</AzureFunctionsVersion>
    <OutputType>Library</OutputType>
    <PlatformTarget>x64</PlatformTarget>
    <LogicAppFolder>${logicAppRelativePath}</LogicAppFolder>
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
      <DirsToClean Include="$(LogicAppFolder)\\lib\\custom" />
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
          DestinationFolder="$(LogicAppFolder)\\lib\\custom\\%(RecursiveDir)"
          SkipUnchangedFiles="true" />
    <Copy SourceFiles="@(CopyFiles2)"
          DestinationFolder="$(LogicAppFolder)\\lib\\custom\\net472\\"
          SkipUnchangedFiles="true" />
    <ItemGroup>
      <MoveFiles Include="$(LogicAppFolder)\\lib\\custom\\bin\\*.*" />
    </ItemGroup>
    <Move SourceFiles="@(MoveFiles)"
          DestinationFolder="$(LogicAppFolder)\\lib\\custom\\net472" />
    <ItemGroup>
      <DirsToClean2 Include="$(LogicAppFolder)\\lib\\custom\\bin" />
    </ItemGroup>
    <RemoveDir Directories="@(DirsToClean2)" />
  </Target>

  <ItemGroup>
    <Reference Include="Microsoft.CSharp" />
  </ItemGroup>
</Project>
`;
}

function generateFunctionJson(namespace: string, functionName: string): Record<string, unknown> {
  // FIX-2: Add InputSchema, Trigger, Cardinality, Raw fields — matches canonical function.json
  // from Sample LogicApps/las-training 2/LAS-Training/lib/custom/test/function.json
  const binding = {
    Name: 'requestBody',
    Connection: null,
    Type: 'workflowActionTrigger',
    Properties: {},
    Direction: 'In',
    DataType: null,
    Cardinality: null,
    IsTrigger: true,
    IsReturn: false,
    Raw: null,
  };
  return {
    Name: null,
    ScriptFile: `../bin/${functionName}.dll`,
    FunctionDirectory: null,
    EntryPoint: `${namespace}.${functionName}.Run`,
    Language: 'net472',
    Properties: {},
    Bindings: [binding],
    InputBindings: [binding],
    OutputBindings: [],
    Trigger: binding,
    InputSchema: {
      type: 'object',
      properties: {
        requestBody: { type: 'string' },
      },
      required: ['requestBody'],
    },
  };
}

function generateSolutionFile(projectName: string): string {
  // FIX-13: Minimal .sln for Visual Studio to open the Functions project
  const projectGuid = randomGuid();
  const solutionGuid = randomGuid();
  return `
Microsoft Visual Studio Solution File, Format Version 12.00
# Visual Studio Version 17
VisualStudioVersion = 17.0.31903.59
MinimumVisualStudioVersion = 10.0.40219.1
Project("{FAE04EC0-301F-11D3-BF4B-00C04F79EFBC}") = "${projectName}", "${projectName}.csproj", "{${projectGuid}}"
EndProject
Global
	GlobalSection(SolutionConfigurationPlatforms) = preSolution
		Debug|Any CPU = Debug|Any CPU
		Release|Any CPU = Release|Any CPU
	EndGlobalSection
	GlobalSection(ProjectConfigurationPlatforms) = postSolution
		{${projectGuid}}.Debug|Any CPU.ActiveCfg = Debug|Any CPU
		{${projectGuid}}.Debug|Any CPU.Build.0 = Debug|Any CPU
		{${projectGuid}}.Release|Any CPU.ActiveCfg = Release|Any CPU
		{${projectGuid}}.Release|Any CPU.Build.0 = Release|Any CPU
	EndGlobalSection
	GlobalSection(SolutionProperties) = preSolution
		HideSolutionNode = FALSE
	EndGlobalSection
	GlobalSection(ExtensibilityGlobals) = postSolution
		SolutionGuid = {${solutionGuid}}
	EndGlobalSection
EndGlobal
`.trimStart();
}

function randomGuid(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16).toUpperCase();
  });
}

// ─── Static templates ─────────────────────────────────────────────────────────

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
