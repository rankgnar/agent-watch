import { Command } from 'commander';
import chalk from 'chalk';
import { SQLiteStore } from '../../store/sqlite';

export function statsCommand(): Command {
  return new Command('stats')
    .description('Show summary metrics for recent traces')
    .option('--since <hours>', 'Time window in hours', '168') // 7 days
    .option('--db <path>', 'Path to the SQLite database file')
    .action((options) => {
      const store = new SQLiteStore(options.db);
      const sinceMs = Date.now() - parseFloat(options.since) * 60 * 60 * 1000;
      const stats = store.getStats(sinceMs);

      console.log('');
      console.log(chalk.bold.cyan('  agent-watch — Summary Stats'));
      console.log(chalk.dim(`  Last ${options.since}h\n`));

      const errorPct = (stats.errorRate * 100).toFixed(1);
      const errorColor =
        stats.errorRate > 0.1
          ? chalk.red
          : stats.errorRate > 0.02
          ? chalk.yellow
          : chalk.green;

      console.log(`  ${chalk.bold('Total traces:')}   ${chalk.cyan(stats.totalTraces)}`);
      console.log(`  ${chalk.bold('Recent (1h):')}    ${chalk.cyan(stats.recentTraces)}`);
      console.log(
        `  ${chalk.bold('Error rate:')}    ${errorColor(`${errorPct}%`)}`
      );
      console.log(
        `  ${chalk.bold('Avg duration:')}  ${chalk.cyan(formatDuration(stats.avgDurationMs))}`
      );

      if (stats.topFailures.length > 0) {
        console.log('');
        console.log(chalk.bold('  Top failures:'));
        for (const f of stats.topFailures) {
          console.log(
            `    ${chalk.red('✗')} ${f.name.padEnd(40)} ${chalk.dim(`${f.count}x`)}`
          );
        }
      }

      console.log('');
      store.close();
    });
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
