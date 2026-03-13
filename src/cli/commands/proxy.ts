import { Command } from 'commander';
import chalk from 'chalk';

export function proxyCommand(): Command {
  return new Command('proxy')
    .description('Start a transparent proxy that captures all AI API traffic')
    .requiredOption('-t, --target <url>', 'Target API base URL (e.g. https://openrouter.ai/api/v1)')
    .option('-p, --port <number>', 'Proxy port', '4201')
    .option('--dashboard-port <number>', 'Dashboard port', '4200')
    .option('--name <string>', 'Agent name shown in traces', 'proxy')
    .option('--db <path>', 'Path to SQLite database file')
    .action(async (options) => {
      const proxyPort = parseInt(options.port, 10);
      const dashboardPort = parseInt(options.dashboardPort, 10);

      // Start proxy
      const { startProxy } = await import('../../proxy/server');
      const { startDashboard } = await import('../../dashboard/server');

      await startProxy({
        targetUrl: options.target,
        port: proxyPort,
        agentName: options.name,
        dbPath: options.db,
      });

      // Start dashboard on localhost only
      await startDashboard({
        port: dashboardPort,
        host: '127.0.0.1',
        dbPath: options.db,
      });

      // Print banner
      console.log('');
      console.log(chalk.bold.cyan('  [agent-watch]') + ' Proxy mode started\n');
      console.log(
        `  ${chalk.green('✓')} Proxy running on   ${chalk.cyan(`http://localhost:${proxyPort}`)}`
      );
      console.log(
        `  ${chalk.green('✓')} Dashboard:          ${chalk.cyan(`http://localhost:${dashboardPort}`)}`
      );
      console.log(
        `  ${chalk.green('✓')} Target:             ${chalk.yellow(options.target)}\n`
      );
      console.log(
        chalk.bold(
          `  Point your app to ${chalk.cyan(`http://localhost:${proxyPort}`)} instead of your API URL.`
        )
      );
      console.log('');
      console.log(chalk.dim('  All requests are captured automatically.'));
      console.log(chalk.dim('  API keys are forwarded to the target but never stored.'));
      console.log(chalk.dim('  Press Ctrl+C to stop.\n'));

      // Keep process alive
      process.on('SIGINT', () => {
        console.log('\n' + chalk.dim('  Shutting down...'));
        process.exit(0);
      });
      process.on('SIGTERM', () => process.exit(0));

      // Block forever
      await new Promise(() => {/* keep alive */});
    });
}
