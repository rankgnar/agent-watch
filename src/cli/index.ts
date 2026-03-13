#!/usr/bin/env node
import { Command } from 'commander';
import { listCommand } from './commands/list';
import { replayCommand } from './commands/replay';
import { statsCommand } from './commands/stats';
import { serveCommand } from './commands/serve';
import { proxyCommand } from './commands/proxy';

const program = new Command();

program
  .name('agent-watch')
  .description('Observability CLI for AI agents — inspect traces, replay runs, and view the dashboard')
  .version('0.1.0')
  // Top-level --target option triggers proxy mode directly:
  //   agent-watch --target https://openrouter.ai/api/v1
  .option('-t, --target <url>', 'Start proxy mode targeting this API URL')
  .option('-p, --port <number>', 'Proxy port (default: 4201)')
  .option('--dashboard-port <number>', 'Dashboard port (default: 4200)')
  .option('--name <string>', 'Agent name shown in traces (default: proxy)')
  .option('--db <path>', 'Path to SQLite database file');

program.addCommand(listCommand());
program.addCommand(replayCommand());
program.addCommand(statsCommand());
program.addCommand(serveCommand());
program.addCommand(proxyCommand());

// Parse but don't exit yet — check for top-level --target shorthand
program.parseAsync(process.argv).then(async () => {
  const opts = program.opts<{
    target?: string;
    port?: string;
    dashboardPort?: string;
    name?: string;
    db?: string;
  }>();

  // If --target was passed at the top level (no subcommand), run proxy mode
  if (opts.target) {
    const { startProxy } = await import('../proxy/server');
    const { startDashboard } = await import('../dashboard/server');
    const chalk = (await import('chalk')).default;

    const proxyPort = opts.port ? parseInt(opts.port, 10) : 4201;
    const dashboardPort = opts.dashboardPort ? parseInt(opts.dashboardPort, 10) : 4200;
    const agentName = opts.name ?? 'proxy';

    await startProxy({
      targetUrl: opts.target,
      port: proxyPort,
      agentName,
      dbPath: opts.db,
    });

    await startDashboard({
      port: dashboardPort,
      host: '127.0.0.1',
      dbPath: opts.db,
    });

    console.log('');
    console.log(chalk.bold.cyan('  [agent-watch]') + ' Proxy mode started\n');
    console.log(
      `  ${chalk.green('✓')} Proxy running on   ${chalk.cyan(`http://localhost:${proxyPort}`)}`
    );
    console.log(
      `  ${chalk.green('✓')} Dashboard:          ${chalk.cyan(`http://localhost:${dashboardPort}`)}`
    );
    console.log(
      `  ${chalk.green('✓')} Target:             ${chalk.yellow(opts.target)}\n`
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

    process.on('SIGINT', () => {
      console.log('\n' + chalk.dim('  Shutting down...'));
      process.exit(0);
    });
    process.on('SIGTERM', () => process.exit(0));

    await new Promise(() => {/* keep alive */});
  }
}).catch((err) => {
  console.error(err);
  process.exit(1);
});
