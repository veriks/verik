import { Command } from 'commander';
import { buildRunCommand } from './commands/run.js';
import { buildInitCommand } from './commands/init.js';
import { buildStatusCommand } from './commands/status.js';
import { buildReportCommand } from './commands/report.js';
import { buildExplainCommand } from './commands/explain.js';
import { buildVerifyCommand } from './commands/verify.js';
import { buildConfigCommand } from './commands/config.js';

const VERSION = '0.1.0';

const program = new Command();

program
  .name('crosscheck')
  .description('Independent verification runtime for AI-generated code')
  .version(VERSION, '-v, --version', 'Print version')
  .addHelpText('after', `
Examples:
  crosscheck init
  crosscheck run -- claude -p "Add password reset"
  crosscheck run -- npm run generate
  crosscheck verify
  crosscheck report
  crosscheck explain
  crosscheck status
`);

program.addCommand(buildRunCommand());
program.addCommand(buildInitCommand());
program.addCommand(buildStatusCommand());
program.addCommand(buildReportCommand());
program.addCommand(buildExplainCommand());
program.addCommand(buildVerifyCommand());
program.addCommand(buildConfigCommand());

program.parseAsync(process.argv).catch((err) => {
  console.error('Error:', String(err));
  process.exit(1);
});
