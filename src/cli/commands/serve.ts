import { Command } from 'commander';
import chalk from 'chalk';

export function serveCommand(): Command {
  return new Command('serve')
    .description('Start the web dashboard')
    .option('-p, --port <number>', 'Port to listen on', '4200')
    .option('--host <host>', 'Host to bind to', 'localhost')
    .option('--db <path>', 'Path to the SQLite database file')
    .action(async (options) => {
      const { startDashboard } = await import('../../dashboard/server');
      const port = parseInt(options.port, 10);
      await startDashboard({ port, host: options.host, dbPath: options.db });
      console.log('');
      console.log(
        `  ${chalk.green('✓')} Dashboard running at ${chalk.cyan(`http://${options.host}:${port}`)}`
      );
      console.log(chalk.dim('  Press Ctrl+C to stop.\n'));
    });
}
