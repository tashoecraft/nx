import { Architect } from '@angular-devkit/architect';
import { WorkspaceNodeModulesArchitectHost } from '@angular-devkit/architect/node';
import {
  experimental,
  json,
  logging,
  normalize,
  schema
} from '@angular-devkit/core';
import { NodeJsSyncHost } from '@angular-devkit/core/node';
import { getLogger } from '../shared/logger';
import {
  coerceTypes,
  convertToCamelCase,
  handleErrors,
  Schema
} from '../shared/params';
import { commandName, printHelp } from '../shared/print-help';
import minimist = require('minimist');

export interface RunOptions {
  project: string;
  target: string;
  configuration: string;
  help: boolean;
  runOptions: { [k: string]: any };
}

function throwInvalidInvocation() {
  throw new Error(
    `Specify the project name and the target (e.g., ${commandName} run proj:build)`
  );
}

function parseRunOpts(
  args: string[],
  defaultProjectName: string | null
): RunOptions {
  const runOptions = convertToCamelCase(
    minimist(args, {
      boolean: ['help', 'prod'],
      string: ['configuration', 'project']
    })
  );
  const help = runOptions.help;
  if (!runOptions._ || !runOptions._[0]) {
    throwInvalidInvocation();
  }
  let [project, target, configuration] = runOptions._[0].split(':');
  if (!project && defaultProjectName) project = defaultProjectName;
  if (!project || !target) {
    throwInvalidInvocation();
  }
  if (runOptions.configuration) {
    configuration = runOptions.configuration;
  }
  if (runOptions.prod) {
    configuration = 'production';
  }
  if (runOptions.project) {
    project = runOptions.project;
  }
  const res = { project, target, configuration, help, runOptions };
  delete runOptions['help'];
  delete runOptions['_'];
  delete runOptions['configuration'];
  delete runOptions['prod'];
  delete runOptions['project'];

  return res;
}

function printRunHelp(
  opts: RunOptions,
  schema: Schema,
  logger: logging.Logger
) {
  printHelp(
    `${commandName} run ${opts.project}:${opts.target}`,
    schema,
    logger
  );
}

export async function run(root: string, args: string[], isVerbose: boolean) {
  const logger = getLogger(isVerbose);

  return handleErrors(logger, isVerbose, async () => {
    const fsHost = new NodeJsSyncHost();
    const workspace = await new experimental.workspace.Workspace(
      normalize(root) as any,
      fsHost
    )
      .loadWorkspaceFromHost('workspace.json' as any)
      .toPromise();
    const opts = parseRunOpts(args, workspace.getDefaultProjectName());

    const registry = new json.schema.CoreSchemaRegistry();
    registry.addPostTransform(schema.transforms.addUndefinedDefaults);
    const architectHost = new WorkspaceNodeModulesArchitectHost(
      workspace,
      root
    );
    const architect = new Architect(architectHost, registry);

    const builderConf = await architectHost.getBuilderNameForTarget({
      project: opts.project,
      target: opts.target
    });
    const builderDesc = await architectHost.resolveBuilder(builderConf);
    const flattenedSchema = await registry
      .flatten(builderDesc.optionSchema! as json.JsonObject)
      .toPromise();
    if (opts.help) {
      printRunHelp(opts, flattenedSchema as any, logger);
      return 0;
    } else {
      const runOptions = coerceTypes(opts.runOptions, flattenedSchema as any);
      const run = await architect.scheduleTarget(
        {
          project: opts.project,
          target: opts.target,
          configuration: opts.configuration
        },
        runOptions,
        { logger }
      );
      const result = await run.output.toPromise();
      await run.stop();
      return result.success ? 0 : 1;
    }
  });
}
