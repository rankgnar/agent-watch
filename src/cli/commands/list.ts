import { Command } from 'commander';
import chalk from 'chalk';
import { SQLiteStore } from '../../store/sqlite';

export function listCommand(): Command {
  return new Command('list')
    .description('Show recent traces')
    .option('-n, --limit <number>', 'Number of traces to show', '20')
    .option('-a, --agent <name>', 'Filter by agent name')
    .option('-s, --status <status>', 'Filter by status (ok|error|running)')
    .option('--since <hours>', 'Only show traces from the last N hours', '24')
    .option('--db <path>', 'Path to the SQLite database file')
    .action((options) => {
      const store = new SQLiteStore(options.db);

      const since = Date.now() - parseFloat(options.since) * 60 * 60 * 1000;
      const traces = store.listTraces({
        limit: parseInt(options.limit, 10),
        agentName: options.agent,
        status: options.status,
        since,
      });

      if (traces.length === 0) {
        console.log(chalk.dim('No traces found.'));
        store.close();
        return;
      }

      const header = [
        chalk.bold.cyan('ID'.padEnd(10)),
        chalk.bold.cyan('Agent'.padEnd(18)),
        chalk.bold.cyan('Name'.padEnd(30)),
        chalk.bold.cyan('Status'.padEnd(10)),
        chalk.bold.cyan('Duration'.padEnd(12)),
        chalk.bold.cyan('Started'),
      ].join('  ');
      console.log(header);
      console.log(chalk.dim('─'.repeat(100)));

      for (const trace of traces) {
        const id = trace.id.slice(0, 8);
        const agent = trace.agentName.slice(0, 18).padEnd(18);
        const name = trace.name.slice(0, 30).padEnd(30);
        const statusColored =
          trace.status === 'ok'
            ? chalk.green('ok'.padEnd(10))
            : trace.status === 'error'
            ? chalk.red('error'.padEnd(10))
            : chalk.yellow('running'.padEnd(10));
        const duration =
          trace.endTime !== undefined
            ? formatDuration(trace.endTime - trace.startTime).padEnd(12)
            : chalk.dim('—'.padEnd(12));
        const started = new Date(trace.startTime).toLocaleString();

        console.log(
          [chalk.dim(id), agent, name, statusColored, duration, started].join('  ')
        );
      }

      console.log(chalk.dim(`\n${traces.length} trace(s) shown`));
      store.close();
    });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
