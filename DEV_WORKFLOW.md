# Wilson Development Workflow

## Auto-Rebuild Setup

Wilson now automatically rebuilds when you make code changes!

### Currently Running
Watch mode is active and monitoring for changes in `src/`

### How It Works
1. Make changes to any file in `src/`
2. Bun automatically detects the change and rebuilds
3. The updated `wilson` CLI is instantly available in your terminal
4. No manual `bun run build` needed!

### Start Watch Mode
```bash
cd ~/Desktop/wilson
bun run build:watch
```

This runs in the background and continuously watches for changes.

### Check Watch Mode Status
```bash
# See if watch mode is running
ps aux | grep "bun.*build.*watch"

# Or check background jobs
jobs
```

### Stop Watch Mode
If you need to stop the auto-rebuild:
```bash
# Find the process
ps aux | grep "bun.*build.*watch"

# Kill it
pkill -f "bun.*build.*watch"
```

### Manual Build (if needed)
```bash
bun run build
```

### Testing Your Changes
1. Edit a file in `src/` (e.g., `src/components/Footer.tsx`)
2. Watch mode automatically rebuilds (takes ~50-100ms)
3. Run `wilson` in a new terminal tab to test
4. Changes are live immediately!

### Development Tips
- Keep watch mode running in the background during development
- Changes to TypeScript/React components rebuild automatically
- The CLI binary at `/Users/whale/.bun/bin/wilson` updates instantly
- No need to restart your terminal or re-link

## Current Status
✅ Watch mode active (PID: check with `ps aux | grep bun.*watch`)
✅ Auto-rebuild on file changes
✅ Live updates to Wilson CLI
