#!/usr/bin/env node
import { Command } from 'commander';
import { listCommand } from './commands/list';
import { replayCommand } from './commands/replay';
import { statsCommand } from './commands/stats';
import { serveCommand } from './commands/serve';

const program = new Command();

program
  .name('agent-watch')
  .description('Observability CLI for AI agents — inspect traces, replay runs, and view the dashboard')
  .version('0.1.0');

program.addCommand(listCommand());
program.addCommand(replayCommand());
program.addCommand(statsCommand());
program.addCommand(serveCommand());

program.parse(process.argv);
