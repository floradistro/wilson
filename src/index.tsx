#!/usr/bin/env bun
import { render } from 'ink';
import { App } from './App.js';
import { ErrorBoundary } from './components/ErrorBoundary.js';
import { parseArgs, printHelp, printVersion } from './utils/args.js';

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

// Run headless test mode
if (firstArg === 'test') {
  const testMessage = process.argv.slice(3).join(' ') || 'list the files in the current directory';
  import('./utils/headless-test.js').then(mod => mod.runHeadlessTest(testMessage)).catch(console.error);
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

  waitUntilExit().then(() => {
    process.exit(0);
  });
}
