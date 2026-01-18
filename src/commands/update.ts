import { updater } from '../services/updater.js'

export async function updateCommand(): Promise<void> {
  console.log('🔍 Checking for Wilson updates...\n')
  
  try {
    await updater.interactiveUpdate()
  } catch (error) {
    console.error('Failed to update Wilson:', error)
    process.exit(1)
  }
}

export async function checkUpdatesCommand(): Promise<void> {
  try {
    const release = await updater.checkForUpdates()
    
    if (release) {
      console.log(`📦 Wilson v${release.version} is available`)
      console.log(`📅 Released: ${new Date(release.created_at).toLocaleDateString()}`)
      console.log('\nRun `wilson update` to install')
    } else {
      console.log('✅ Wilson is up to date')
    }
  } catch (error) {
    console.error('Failed to check for updates:', error)
    process.exit(1)
  }
}