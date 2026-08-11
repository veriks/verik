import { Command } from 'commander';
import { migrateIfNeeded } from '../storage/migrate.js';
import { formatError } from '../shared/format-error.js';
import { block } from './output/theme.js';
import { buildRunCommand } from './commands/run.js';
import { buildInitCommand } from './commands/init.js';
import { buildStatusCommand } from './commands/status.js';
import { buildReportCommand } from './commands/report.js';
import { buildExplainCommand } from './commands/explain.js';
import { buildVerifyCommand } from './commands/verify.js';
import { buildConfigCommand } from './commands/config.js';
import { buildDemoCommand } from './commands/demo.js';
import { buildInspectCommand } from './commands/inspect.js';
import { buildRunsCommand } from './commands/runs.js';
import { buildOverrideCommand } from './commands/override.js';
import { buildDoctorCommand } from './commands/doctor.js';
import { buildDryRunCommand } from './commands/dry-run.js';
import { buildBeginCommand } from './commands/begin.js';
import { buildHookCommand } from './commands/hook.js';
import { buildRulesCommand } from './commands/rules.js';
import { buildPolicyCommand } from './commands/policy.js';
import { banner } from './output/theme.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('verik')
  .description('Independent verification runtime for AI-generated code')
  .version(VERSION, '-v, --version', 'Print version')
  .addHelpText('beforeAll', banner() + '\n')
  .addHelpText(
    'after',
    `
Examples:
  verik init
  verik run -- claude -p "Add password reset"
  verik verify
  verik runs
  verik report
  verik explain
  verik inspect
  verik override add --rule secret-leak --reason "dev env only"
`,
  );

program.addCommand(buildRunCommand());
program.addCommand(buildDryRunCommand());
program.addCommand(buildBeginCommand());
program.addCommand(buildHookCommand());
program.addCommand(buildRulesCommand());
program.addCommand(buildPolicyCommand());
program.addCommand(buildInitCommand());
program.addCommand(buildDoctorCommand());
program.addCommand(buildStatusCommand());
program.addCommand(buildRunsCommand());
program.addCommand(buildReportCommand());
program.addCommand(buildExplainCommand());
program.addCommand(buildVerifyCommand());
program.addCommand(buildInspectCommand());
program.addCommand(buildOverrideCommand());
program.addCommand(buildDemoCommand());
program.addCommand(buildConfigCommand());

// `.crosscheck/` predates the rename and holds the config, the policy, the
// checkpoint and every run record. Move it before any command resolves a path,
// so an existing install keeps its baseline and history instead of silently
// starting over.
//
// A preAction hook rather than a top-level await: esbuild cannot emit
// top-level await for the CJS target, and that target is what the standalone
// binaries are built from. The ESM bundle compiled fine, so this only broke
// `build:bin`.
program.hook('preAction', async () => {
  await migrateIfNeeded(process.cwd());
});

program.parseAsync(process.argv).catch((err) => {
  console.error(`${block('✕')} ${formatError(err)}`);
  process.exit(1);
});
