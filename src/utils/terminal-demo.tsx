#!/usr/bin/env bun
/**
 * Terminal Visualizer Demo
 *
 * Run: bun src/utils/terminal-demo.tsx
 */

import React, { useState, useEffect } from 'react';
import { render, Box, Text } from 'ink';
import {
  ActionList,
  CommandDisplay,
  StepProgress,
  TestResults,
  LogStream,
  CodeBlock,
  Divider,
  type Action,
  type Step,
  type TestResult,
} from '../components/TerminalVisualizer.js';

function Demo() {
  const [actions, setActions] = useState<Action[]>([
    { id: '1', label: 'Products API', status: 'success', detail: '200', duration: 145 },
    { id: '2', label: 'Categories API', status: 'success', detail: '200', duration: 89 },
    { id: '3', label: 'Locations API', status: 'running', detail: 'fetching...' },
    { id: '4', label: 'Store API', status: 'pending' },
  ]);

  const [steps, setSteps] = useState<Step[]>([
    { label: 'Initialize database connection', status: 'success' },
    { label: 'Load configuration', status: 'success', detail: 'config.json' },
    { label: 'Validate API endpoints', status: 'running', detail: '3/5 checked' },
    { label: 'Run integration tests', status: 'pending' },
    { label: 'Generate report', status: 'pending' },
  ]);

  const tests: TestResult[] = [
    { name: 'auth.login', status: 'pass', duration: 234 },
    { name: 'auth.logout', status: 'pass', duration: 89 },
    { name: 'products.list', status: 'pass', duration: 456 },
    { name: 'products.create', status: 'fail', duration: 123, error: 'Missing required field: price' },
    { name: 'cart.add', status: 'pass', duration: 234 },
    { name: 'cart.checkout', status: 'skip' },
  ];

  const logs = [
    '[INFO] Starting Wilson test suite...',
    '[INFO] Connected to database',
    '[DEBUG] Loading fixtures...',
    '[INFO] Running 6 tests',
    '[PASS] auth.login (234ms)',
    '[PASS] auth.logout (89ms)',
    '[PASS] products.list (456ms)',
    '[FAIL] products.create - Missing required field: price',
  ];

  // Simulate progress
  useEffect(() => {
    const timeout = setTimeout(() => {
      setActions(prev => prev.map(a =>
        a.id === '3' ? { ...a, status: 'success', detail: '200', duration: 312 } :
        a.id === '4' ? { ...a, status: 'running', detail: 'fetching...' } : a
      ));
    }, 2000);

    const timeout2 = setTimeout(() => {
      setActions(prev => prev.map(a =>
        a.id === '4' ? { ...a, status: 'error', detail: '400', duration: 156 } : a
      ));
      setSteps(prev => prev.map((s, i) =>
        i === 2 ? { ...s, status: 'success', detail: '5/5 checked' } :
        i === 3 ? { ...s, status: 'running', detail: '2/6 tests' } : s
      ));
    }, 4000);

    return () => {
      clearTimeout(timeout);
      clearTimeout(timeout2);
    };
  }, []);

  return (
    <Box flexDirection="column" padding={1}>
      <Text color="#61AFEF" bold>
        ╔══════════════════════════════════════════════════╗
        ║  Terminal Visualizer Demo                        ║
        ╚══════════════════════════════════════════════════╝
      </Text>

      <Divider label="API Calls" />
      <ActionList title="Testing API Endpoints" actions={actions} />

      <Divider label="Step Progress" />
      <StepProgress title="Validation Pipeline" steps={steps} />

      <Divider label="Test Results" />
      <TestResults tests={tests} title="Unit Tests" />

      <Divider label="Live Logs" />
      <LogStream lines={logs} title="Console Output" maxLines={6} />

      <Divider label="Command Execution" />
      <CommandDisplay
        command="npm run build"
        status="success"
        duration={2341}
        output="Bundled 799 modules in 85ms\n  index.js  2.0 MB  (entry point)"
      />

      <Divider label="Code Output" />
      <CodeBlock
        title="Response"
        language="json"
        code={`{
  "products": [
    { "id": "prod_123", "name": "Widget", "price": 29.99 },
    { "id": "prod_456", "name": "Gadget", "price": 49.99 }
  ],
  "total": 2,
  "status": "success"
}`}
      />

      <Box marginTop={1}>
        <Text color="#5C6370">Press Ctrl+C to exit</Text>
      </Box>
    </Box>
  );
}

render(<Demo />);
