import { Command } from 'commander';
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
import { banner } from './output/theme.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('crosscheck')
  .description('Independent verification runtime for AI-generated code')
  .version(VERSION, '-v, --version', 'Print version')
  .addHelpText('beforeAll', banner() + '\n')
  .addHelpText(
    'after',
    `
Examples:
  crosscheck init
  crosscheck run -- claude -p "Add password reset"
  crosscheck verify
  crosscheck runs
  crosscheck report
  crosscheck explain
  crosscheck inspect
  crosscheck override add --rule secret-leak --reason "dev env only"
`,
  );

program.addCommand(buildRunCommand());
program.addCommand(buildDryRunCommand());
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

program.parseAsync(process.argv).catch((err) => {
  console.error('Error:', String(err));
  process.exit(1);
});
