#!/usr/bin/env node

// Polyfill localStorage for react-devtools-core (used by Ink)
// Node.js doesn't have localStorage, but react-devtools expects it
const memoryStorage = new Map<string, string>();
(globalThis as any).localStorage = {
  getItem: (key: string) => memoryStorage.get(key) ?? null,
  setItem: (key: string, value: string) => memoryStorage.set(key, value),
  removeItem: (key: string) => memoryStorage.delete(key),
  clear: () => memoryStorage.clear(),
  get length() { return memoryStorage.size; },
  key: (index: number) => Array.from(memoryStorage.keys())[index] ?? null,
};

import { render } from 'ink';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { parseArgs, printHelp, printVersion } from './utils/args.js';
import { flushTelemetrySync } from './services/telemetry.js';
import { validateTerminal } from './utils/terminal.js';

// Parse command line arguments
const args = parseArgs(process.argv.slice(2));

// Handle help
if (args.flags.help) {
  printHelp();
  process.exit(0);
}

// Handle version
if (args.flags.version) {
  printVersion();
  process.exit(0);
}

// Check for special commands
const firstArg = process.argv[2];

// Validate terminal capabilities (skip for non-interactive commands)
const isInteractive = !['test', 'update', 'check-updates', 'logout', 'version'].includes(firstArg || '');
if (isInteractive && !args.flags.help && !args.flags.version) {
  const terminalError = validateTerminal();
  if (terminalError) {
    console.error(`\x1b[33m⚠ ${terminalError}\x1b[0m`);
    // Don't exit, just warn - the CLI might still work
  }
}

// Run headless test mode
if (firstArg === 'test') {
  const testMessage = process.argv.slice(3).join(' ') || 'list the files in the current directory';
  import('./utils/headless-test.js').then(mod => mod.runHeadlessTest(testMessage)).catch(console.error);
} else if (firstArg === 'update') {
  // Handle update command directly
  import('./commands/update.js').then(mod => mod.updateCommand()).catch(console.error);
} else if (firstArg === 'check-updates') {
  // Handle check-updates command directly
  import('./commands/update.js').then(mod => mod.checkUpdatesCommand()).catch(console.error);
} else {
  // Normal mode - determine command and render the app
  let command: string | undefined;

  if (firstArg === 'login') {
    command = 'login';
  } else if (firstArg === 'logout') {
    command = 'logout';
  } else if (firstArg === 'version') {
    command = 'version';
  }

  const { waitUntilExit } = render(
    <ErrorBoundary>
      <App
        initialQuery={command ? undefined : args.query}
        flags={args.flags}
        command={command}
      />
    </ErrorBoundary>
  );

  waitUntilExit().then(async () => {
    // Flush any pending telemetry before exit
    await flushTelemetrySync();
    process.exit(0);
  });
}