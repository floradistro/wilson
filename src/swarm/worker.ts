// =============================================================================
// Swarm Worker - Not used in simple mode
// =============================================================================
//
// In the simple swarm implementation, we just run regular Wilson instances
// with tasks passed as initialQuery. No special worker mode needed.
//
// The --worker flag is no longer used.
// Workers are just: wilson --dangerously-skip-permissions "task"
//

export async function runWorkerLoop(): Promise<void> {
  console.log('Worker mode not used in simple swarm. Workers are regular Wilson instances.');
  process.exit(0);
}
