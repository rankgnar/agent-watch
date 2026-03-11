import { Command } from 'commander';
import chalk from 'chalk';
import { SQLiteStore } from '../../store/sqlite';
import type { SpanRecord } from '../../types';

export function replayCommand(): Command {
  return new Command('replay')
    .description('Show the full span tree for a trace')
    .argument('<id>', 'Trace ID or prefix (first 8 chars)')
    .option('--db <path>', 'Path to the SQLite database file')
    .action((id: string, options) => {
      const store = new SQLiteStore(options.db);

      // Allow prefix search
      const traces = store.listTraces({ limit: 200 });
      const match = traces.find(
        (t) => t.id === id || t.id.startsWith(id)
      );

      if (!match) {
        console.error(chalk.red(`Trace not found: ${id}`));
        store.close();
        process.exit(1);
      }

      const spans = store.getSpansForTrace(match.id);

      // Header
      const statusColor =
        match.status === 'ok'
          ? chalk.green
          : match.status === 'error'
          ? chalk.red
          : chalk.yellow;

      console.log('');
      console.log(
        chalk.bold(`Trace: ${chalk.cyan(match.name)}`) +
          '  ' +
          statusColor(`[${match.status}]`)
      );
      console.log(chalk.dim(`ID:    ${match.id}`));
      console.log(chalk.dim(`Agent: ${match.agentName}`));
      console.log(
        chalk.dim(
          `Time:  ${new Date(match.startTime).toLocaleString()}${
            match.endTime
              ? `  →  ${formatDuration(match.endTime - match.startTime)}`
              : '  (running)'
          }`
        )
      );
      console.log('');

      if (spans.length === 0) {
        console.log(chalk.dim('  No spans recorded.'));
      } else {
        printSpanTree(spans);
      }

      console.log('');
      store.close();
    });
}

function printSpanTree(spans: SpanRecord[]): void {
  // Build a tree structure
  const byId = new Map<string, SpanRecord>();
  const children = new Map<string | undefined, SpanRecord[]>();

  for (const span of spans) {
    byId.set(span.id, span);
    const parent = span.parentSpanId;
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent)!.push(span);
  }

  function printNode(span: SpanRecord, prefix: string, isLast: boolean): void {
    const connector = isLast ? '└─' : '├─';
    const childPrefix = isLast ? '   ' : '│  ';

    const statusIcon =
      span.status === 'ok'
        ? chalk.green('✓')
        : span.status === 'error'
        ? chalk.red('✗')
        : chalk.yellow('●');

    const duration =
      span.endTime !== undefined
        ? chalk.dim(` ${formatDuration(span.endTime - span.startTime)}`)
        : chalk.dim(' (running)');

    const nameStr = span.status === 'error'
      ? chalk.red(span.name)
      : chalk.white(span.name);

    console.log(`${prefix}${connector} ${statusIcon} ${nameStr}${duration}`);

    if (span.errorMessage) {
      console.log(
        `${prefix}${childPrefix}  ${chalk.red('↳ Error:')} ${chalk.dim(span.errorMessage)}`
      );
    }

    if (span.attributes && Object.keys(span.attributes).length > 0) {
      const attrs = Object.entries(span.attributes)
        .filter(([, v]) => v !== undefined && v !== null)
        .map(([k, v]) => `${chalk.dim(k)}=${chalk.cyan(String(v))}`)
        .join('  ');
      if (attrs) {
        console.log(`${prefix}${childPrefix}  ${attrs}`);
      }
    }

    const kids = children.get(span.id) ?? [];
    for (let i = 0; i < kids.length; i++) {
      printNode(kids[i], prefix + childPrefix, i === kids.length - 1);
    }
  }

  const roots = children.get(undefined) ?? [];
  for (let i = 0; i < roots.length; i++) {
    printNode(roots[i], '', i === roots.length - 1);
  }
}

function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`;
  return `${(ms / 60000).toFixed(1)}m`;
}
