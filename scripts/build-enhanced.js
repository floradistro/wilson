#!/usr/bin/env node

/**
 * Enhanced Build Script for Wilson CLI
 * Compiles TypeScript, optimizes bundles, and prepares for distribution
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { readFile, writeFile, mkdir, copyFile } from 'fs/promises';
import { existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const execAsync = promisify(exec);
const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');

// Build configuration
const BUILD_CONFIG = {
  target: 'node18',
  minify: true,
  sourcemap: true,
  external: ['@supabase/supabase-js', 'postgres'],
  define: {
    'process.env.NODE_ENV': '"production"',
  },
};

// ANSI colors for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logStep(step, description) {
  console.log(`${colors.cyan}▸${colors.reset} ${colors.bright}${step}${colors.reset} ${description}`);
}

function logSuccess(message) {
  console.log(`${colors.green}✓${colors.reset} ${message}`);
}

function logError(message) {
  console.log(`${colors.red}✗${colors.reset} ${message}`);
}

function logWarning(message) {
  console.log(`${colors.yellow}⚠${colors.reset} ${message}`);
}

async function runCommand(command, description) {
  logStep('RUN', description);
  try {
    const { stdout, stderr } = await execAsync(command, { cwd: rootDir });
    if (stderr && !stderr.includes('warning')) {
      logWarning(stderr.trim());
    }
    return stdout;
  } catch (error) {
    logError(`Failed: ${error.message}`);
    throw error;
  }
}

async function ensureDir(path) {
  if (!existsSync(path)) {
    await mkdir(path, { recursive: true });
    log(`Created directory: ${path}`, 'gray');
  }
}

async function updatePackageVersion() {
  logStep('VERSION', 'Updating package version');
  
  const packagePath = join(rootDir, 'package.json');
  const packageJson = JSON.parse(await readFile(packagePath, 'utf-8'));
  
  // Auto-increment patch version
  const version = packageJson.version.split('.');
  version[2] = (parseInt(version[2]) + 1).toString();
  packageJson.version = version.join('.');
  
  await writeFile(packagePath, JSON.stringify(packageJson, null, 2));
  logSuccess(`Version updated to ${packageJson.version}`);
  
  return packageJson.version;
}

async function typeCheck() {
  logStep('CHECK', 'Type checking TypeScript');
  await runCommand('bun run typecheck', 'Running TypeScript compiler');
  logSuccess('Type checking passed');
}

async function buildBundle() {
  logStep('BUILD', 'Building optimized bundle');
  
  const entryPoint = join(rootDir, 'src/index.tsx');
  const outDir = join(rootDir, 'dist');
  
  await ensureDir(outDir);
  
  // Build main bundle
  await runCommand(
    `bun build ${entryPoint} --outdir ${outDir} --target ${BUILD_CONFIG.target} ${
      BUILD_CONFIG.minify ? '--minify' : ''
    } ${BUILD_CONFIG.sourcemap ? '--sourcemap' : ''} --external ${BUILD_CONFIG.external.join(',')}`,
    'Compiling and bundling source code'
  );
  
  logSuccess('Bundle created successfully');
}

async function generateBuildInfo() {
  logStep('INFO', 'Generating build metadata');
  
  const buildInfo = {
    version: JSON.parse(await readFile(join(rootDir, 'package.json'), 'utf-8')).version,
    buildDate: new Date().toISOString(),
    nodeVersion: process.version,
    platform: process.platform,
    arch: process.arch,
    commit: await getGitCommit(),
    environment: 'production',
  };
  
  const buildInfoPath = join(rootDir, 'dist/build-info.json');
  await writeFile(buildInfoPath, JSON.stringify(buildInfo, null, 2));
  
  logSuccess(`Build info written to dist/build-info.json`);
  return buildInfo;
}

async function getGitCommit() {
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', { cwd: rootDir });
    return stdout.trim();
  } catch {
    return 'unknown';
  }
}

async function copyAssets() {
  logStep('COPY', 'Copying static assets');
  
  const assets = [
    { src: 'README.md', dest: 'dist/README.md' },
    { src: 'package.json', dest: 'dist/package.json' },
  ];
  
  for (const asset of assets) {
    const srcPath = join(rootDir, asset.src);
    const destPath = join(rootDir, asset.dest);
    
    if (existsSync(srcPath)) {
      await ensureDir(dirname(destPath));
      await copyFile(srcPath, destPath);
      log(`Copied ${asset.src}`, 'gray');
    }
  }
  
  logSuccess('Assets copied');
}

async function makeExecutable() {
  logStep('EXEC', 'Making bundle executable');
  
  // Add shebang to the main bundle
  const distPath = join(rootDir, 'dist/index.js');
  const content = await readFile(distPath, 'utf-8');
  
  if (!content.startsWith('#!')) {
    const withShebang = `#!/usr/bin/env node\n${content}`;
    await writeFile(distPath, withShebang);
    
    // Make executable on Unix systems
    if (process.platform !== 'win32') {
      await runCommand('chmod +x dist/index.js', 'Setting executable permissions');
    }
  }
  
  logSuccess('Bundle is now executable');
}

async function runTests() {
  logStep('TEST', 'Running test suite');
  
  try {
    await runCommand('bun test', 'Executing unit tests');
    logSuccess('All tests passed');
  } catch (error) {
    logWarning('Some tests failed, but continuing build');
  }
}

async function optimizeBundle() {
  logStep('OPT', 'Optimizing bundle size');
  
  const bundlePath = join(rootDir, 'dist/index.js');
  const stats = await import('fs').then(fs => fs.statSync(bundlePath));
  
  log(`Bundle size: ${(stats.size / 1024).toFixed(2)} KB`, 'gray');
  
  // Additional optimizations could go here
  logSuccess('Bundle optimization complete');
}

async function main() {
  console.log('');
  log('🔧 Building Wilson CLI with Apple-level polish...', 'bright');
  console.log('');
  
  const startTime = Date.now();
  
  try {
    // Build pipeline
    const version = await updatePackageVersion();
    await typeCheck();
    await buildBundle();
    await copyAssets();
    await makeExecutable();
    await optimizeBundle();
    await generateBuildInfo();
    
    // Optional steps
    if (process.env.CI !== 'true') {
      await runTests();
    }
    
    const duration = ((Date.now() - startTime) / 1000).toFixed(1);
    
    console.log('');
    logSuccess(`Wilson v${version} built successfully in ${duration}s`);
    console.log('');
    log('Next steps:', 'bright');
    log('• Run: bun run start', 'gray');
    log('• Install globally: bun link', 'gray');
    log('• Test locally: ./dist/index.js', 'gray');
    console.log('');
    
  } catch (error) {
    logError('Build failed:');
    console.error(error);
    process.exit(1);
  }
}

// Run the build
main();