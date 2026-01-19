/**
 * Xcode and iOS Development Tools
 *
 * Local tools for building, testing, and managing iOS/macOS projects.
 * These run on the client machine where Wilson CLI is installed.
 */

import { execSync, spawn, type ChildProcess } from 'child_process';
import type { Tool, ToolResult } from '../types.js';

// =============================================================================
// Types
// =============================================================================

interface XcodeBuildParams {
  path: string;
  scheme?: string;
  configuration?: string;
  destination?: string;
  action?: string;
  derived_data_path?: string;
  quiet?: boolean;
}

interface SimctlParams {
  action: string;
  device?: string;
  app_path?: string;
  bundle_id?: string;
  url?: string;
  output_path?: string;
}

interface XcrunParams {
  tool: string;
  args?: string[];
  sdk?: string;
}

interface SwiftPackageParams {
  action: string;
  path?: string;
  configuration?: string;
  product?: string;
}

// =============================================================================
// Helper Functions
// =============================================================================

const DEFAULT_TIMEOUT = 300000; // 5 minutes for builds
const MAX_OUTPUT = 50000;

/**
 * Check if full Xcode is installed (not just Command Line Tools)
 */
function checkXcodeInstalled(): { installed: boolean; path?: string; error?: string } {
  try {
    const path = execSync('xcode-select -p', { encoding: 'utf8', timeout: 5000 }).trim();

    // Check if it's the full Xcode, not just Command Line Tools
    if (path.includes('/Applications/Xcode')) {
      return { installed: true, path };
    }

    return {
      installed: false,
      error: `Xcode not properly configured. Current developer directory: ${path}\n\nTo fix:\n1. Install Xcode from the App Store\n2. Run: sudo xcode-select -s /Applications/Xcode.app/Contents/Developer\n3. Accept license: sudo xcodebuild -license accept`,
    };
  } catch (error) {
    return {
      installed: false,
      error: 'Xcode not installed. Install from App Store or run: xcode-select --install',
    };
  }
}

/**
 * Sanitize path for shell execution
 */
function sanitizePath(path: string): string {
  return path.replace(/[`$();&|<>]/g, '');
}

// =============================================================================
// XcodeBuild Tool
// =============================================================================

export const xcodeBuildTool: Tool = {
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      path,
      scheme,
      configuration = 'Debug',
      destination,
      action = 'build',
      derived_data_path,
      quiet,
    } = params as unknown as XcodeBuildParams;

    if (!path) {
      return { success: false, error: 'Missing path to .xcodeproj or .xcworkspace' };
    }

    // Check Xcode is properly installed
    const xcodeCheck = checkXcodeInstalled();
    if (!xcodeCheck.installed) {
      return { success: false, error: xcodeCheck.error };
    }

    try {
      const safePath = sanitizePath(path);
      const args: string[] = ['xcodebuild'];

      // Project or workspace
      if (safePath.endsWith('.xcworkspace')) {
        args.push('-workspace', `"${safePath}"`);
      } else if (safePath.endsWith('.xcodeproj')) {
        args.push('-project', `"${safePath}"`);
      } else {
        return { success: false, error: 'Path must be a .xcodeproj or .xcworkspace file' };
      }

      // Scheme (try to auto-detect if not provided)
      if (scheme) {
        args.push('-scheme', `"${scheme}"`);
      }

      // Configuration
      args.push('-configuration', configuration);

      // Destination
      if (destination) {
        args.push('-destination', `"${destination}"`);
      }

      // Derived data path
      if (derived_data_path) {
        args.push('-derivedDataPath', `"${sanitizePath(derived_data_path)}"`);
      }

      // Quiet mode
      if (quiet) {
        args.push('-quiet');
      }

      // Action
      args.push(action);

      const cmd = args.join(' ');

      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: DEFAULT_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Truncate if needed
      const content = output.length > MAX_OUTPUT
        ? output.slice(0, MAX_OUTPUT) + '\n...(output truncated)'
        : output;

      return { success: true, content: content || 'Build completed successfully' };
    } catch (error) {
      if (error instanceof Error && 'stderr' in error) {
        const stderr = (error as NodeJS.ErrnoException & { stderr?: string }).stderr || '';
        return { success: false, error: stderr || error.message };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Build failed' };
    }
  },
};

// =============================================================================
// Simctl Tool (iOS Simulator Control)
// =============================================================================

export const simctlTool: Tool = {
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      action,
      device,
      app_path,
      bundle_id,
      url,
      output_path,
    } = params as unknown as SimctlParams;

    if (!action) {
      return { success: false, error: 'Missing action' };
    }

    try {
      let cmd: string;

      switch (action) {
        case 'list':
          cmd = 'xcrun simctl list --json';
          break;

        case 'boot':
          if (!device) return { success: false, error: 'Device name or UDID required' };
          cmd = `xcrun simctl boot "${sanitizePath(device)}"`;
          break;

        case 'shutdown':
          if (!device) return { success: false, error: 'Device name or UDID required' };
          cmd = `xcrun simctl shutdown "${sanitizePath(device)}"`;
          break;

        case 'erase':
          if (!device) return { success: false, error: 'Device name or UDID required' };
          cmd = `xcrun simctl erase "${sanitizePath(device)}"`;
          break;

        case 'install':
          if (!device) return { success: false, error: 'Device name or UDID required' };
          if (!app_path) return { success: false, error: 'App path required' };
          cmd = `xcrun simctl install "${sanitizePath(device)}" "${sanitizePath(app_path)}"`;
          break;

        case 'uninstall':
          if (!device) return { success: false, error: 'Device name or UDID required' };
          if (!bundle_id) return { success: false, error: 'Bundle ID required' };
          cmd = `xcrun simctl uninstall "${sanitizePath(device)}" "${bundle_id}"`;
          break;

        case 'launch':
          if (!device) return { success: false, error: 'Device name or UDID required' };
          if (!bundle_id) return { success: false, error: 'Bundle ID required' };
          cmd = `xcrun simctl launch "${sanitizePath(device)}" "${bundle_id}"`;
          break;

        case 'screenshot': {
          if (!device) return { success: false, error: 'Device name or UDID required' };
          const screenshotPath = output_path || `/tmp/simulator_screenshot_${Date.now()}.png`;
          cmd = `xcrun simctl io "${sanitizePath(device)}" screenshot "${sanitizePath(screenshotPath)}"`;
          break;
        }

        case 'openurl':
          if (!device) return { success: false, error: 'Device name or UDID required' };
          if (!url) return { success: false, error: 'URL required' };
          cmd = `xcrun simctl openurl "${sanitizePath(device)}" "${url}"`;
          break;

        case 'status_bar':
          if (!device) return { success: false, error: 'Device name or UDID required' };
          cmd = `xcrun simctl status_bar "${sanitizePath(device)}" override --time "9:41" --batteryState charged --batteryLevel 100 --cellularMode active --cellularBars 4`;
          break;

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: list, boot, shutdown, erase, install, uninstall, launch, screenshot, openurl, status_bar` };
      }

      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: 60000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return { success: true, content: output.trim() || 'Command completed' };
    } catch (error) {
      if (error instanceof Error && 'stderr' in error) {
        const stderr = (error as NodeJS.ErrnoException & { stderr?: string }).stderr || '';
        return { success: false, error: stderr || error.message };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Simctl command failed' };
    }
  },
};

// =============================================================================
// Xcrun Tool (Xcode Developer Tools)
// =============================================================================

export const xcrunTool: Tool = {
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { tool, args = [], sdk } = params as unknown as XcrunParams;

    if (!tool) {
      return { success: false, error: 'Missing tool name' };
    }

    try {
      const cmdArgs: string[] = ['xcrun'];

      if (sdk) {
        cmdArgs.push('--sdk', sdk);
      }

      cmdArgs.push(tool);

      // Add additional args (sanitized)
      for (const arg of args) {
        cmdArgs.push(`"${sanitizePath(String(arg))}"`);
      }

      const cmd = cmdArgs.join(' ');

      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: 120000,
        maxBuffer: 10 * 1024 * 1024,
      });

      return { success: true, content: output.trim() || 'Command completed' };
    } catch (error) {
      if (error instanceof Error && 'stderr' in error) {
        const stderr = (error as NodeJS.ErrnoException & { stderr?: string }).stderr || '';
        return { success: false, error: stderr || error.message };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Xcrun command failed' };
    }
  },
};

// =============================================================================
// Swift Package Tool
// =============================================================================

export const swiftPackageTool: Tool = {
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const {
      action,
      path,
      configuration,
      product,
    } = params as unknown as SwiftPackageParams;

    if (!action) {
      return { success: false, error: 'Missing action' };
    }

    try {
      const args: string[] = ['swift'];
      const cwd = path ? sanitizePath(path) : process.cwd();

      switch (action) {
        case 'build':
          args.push('build');
          if (configuration) args.push('-c', configuration);
          if (product) args.push('--product', product);
          break;

        case 'test':
          args.push('test');
          if (configuration) args.push('-c', configuration);
          break;

        case 'clean':
          args.push('package', 'clean');
          break;

        case 'update':
          args.push('package', 'update');
          break;

        case 'resolve':
          args.push('package', 'resolve');
          break;

        case 'show-dependencies':
          args.push('package', 'show-dependencies', '--format', 'json');
          break;

        case 'generate-xcodeproj':
          args.push('package', 'generate-xcodeproj');
          break;

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: build, test, clean, update, resolve, show-dependencies, generate-xcodeproj` };
      }

      const cmd = args.join(' ');

      const output = execSync(cmd, {
        encoding: 'utf8',
        timeout: DEFAULT_TIMEOUT,
        maxBuffer: 10 * 1024 * 1024,
        cwd,
      });

      return { success: true, content: output.trim() || 'Command completed' };
    } catch (error) {
      if (error instanceof Error && 'stderr' in error) {
        const stderr = (error as NodeJS.ErrnoException & { stderr?: string }).stderr || '';
        return { success: false, error: stderr || error.message };
      }
      return { success: false, error: error instanceof Error ? error.message : 'Swift command failed' };
    }
  },
};

// =============================================================================
// Xcode Select Tool (Check/Switch Xcode versions)
// =============================================================================

export const xcodeSelectTool: Tool = {
  async execute(params: Record<string, unknown>): Promise<ToolResult> {
    const { action, path } = params as { action: string; path?: string };

    if (!action) {
      return { success: false, error: 'Missing action' };
    }

    try {
      switch (action) {
        case 'print-path': {
          const output = execSync('xcode-select -p', { encoding: 'utf8', timeout: 5000 });
          return { success: true, content: output.trim() };
        }

        case 'version': {
          const output = execSync('xcodebuild -version', { encoding: 'utf8', timeout: 5000 });
          return { success: true, content: output.trim() };
        }

        case 'switch':
          if (!path) return { success: false, error: 'Path required for switch action' };
          // Note: This requires sudo, so provide instructions instead
          return {
            success: true,
            content: `To switch Xcode version, run:\nsudo xcode-select -s ${path}\n\nCommon paths:\n- /Applications/Xcode.app/Contents/Developer\n- /Applications/Xcode-15.app/Contents/Developer`,
          };

        case 'install':
          return {
            success: true,
            content: `To install Xcode Command Line Tools, run:\nxcode-select --install\n\nFor full Xcode, install from the App Store.`,
          };

        default:
          return { success: false, error: `Unknown action: ${action}. Valid: print-path, version, switch, install` };
      }
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'xcode-select failed' };
    }
  },
};

// =============================================================================
// Exports
// =============================================================================

export const xcodeTools: Record<string, Tool> = {
  XcodeBuild: xcodeBuildTool,
  Simctl: simctlTool,
  Xcrun: xcrunTool,
  SwiftPackage: swiftPackageTool,
  XcodeSelect: xcodeSelectTool,
};
