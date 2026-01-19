import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import fs from 'fs/promises'
import path from 'path'
import os from 'os'
import { createWriteStream } from 'fs'
import { pipeline } from 'stream/promises'
import { config } from '../config.js'

interface WilsonRelease {
  version: string
  download_url: string
  created_at: string
  is_latest: boolean
  changelog?: string
}

export class WilsonUpdater {
  private supabase = createClient(
    config.apiUrl,
    config.anonKey
  )

  private currentVersion = this.getCurrentVersion()
  private wilsonDir = path.join(os.homedir(), '.wilson')
  private backupDir = path.join(this.wilsonDir, 'backups')

  private getCurrentVersion(): string {
    try {
      const packagePath = path.join(__dirname, '../../package.json')
      const pkg = require(packagePath)
      return pkg.version
    } catch {
      return '0.0.0'
    }
  }

  async checkForUpdates(): Promise<WilsonRelease | null> {
    try {
      const { data, error } = await this.supabase
        .from('wilson_releases')
        .select('*')
        .eq('is_latest', true)
        .single()

      if (error) throw error

      // Compare versions
      if (this.isNewerVersion(data.version, this.currentVersion)) {
        return data
      }

      return null
    } catch (error) {
      console.warn('Failed to check for updates:', error)
      return null
    }
  }

  private isNewerVersion(remote: string, local: string): boolean {
    const parseVersion = (v: string) => v.split('.').map(Number)
    const [rMajor, rMinor, rPatch] = parseVersion(remote)
    const [lMajor, lMinor, lPatch] = parseVersion(local)

    if (rMajor > lMajor) return true
    if (rMajor < lMajor) return false
    if (rMinor > lMinor) return true
    if (rMinor < lMinor) return false
    return rPatch > lPatch
  }

  async downloadUpdate(release: WilsonRelease): Promise<string> {
    console.log(`Downloading Wilson v${release.version}...`)
    
    // Create update directory
    const updateDir = path.join(this.wilsonDir, 'updates', release.version)
    await fs.mkdir(updateDir, { recursive: true })

    // Download release bundle
    const response = await fetch(release.download_url)
    if (!response.ok) throw new Error(`Download failed: ${response.statusText}`)

    const tarPath = path.join(updateDir, 'wilson.tar.gz')
    const fileStream = createWriteStream(tarPath)
    await pipeline(response.body!, fileStream)

    console.log(`Downloaded to ${tarPath}`)
    return tarPath
  }

  async extractUpdate(tarPath: string): Promise<string> {
    const extractDir = path.dirname(tarPath)
    const sourceDir = path.join(extractDir, 'source')
    
    console.log('Extracting update...')
    execSync(`tar -xzf "${tarPath}" -C "${sourceDir}"`, { 
      stdio: 'ignore',
      cwd: extractDir 
    })

    return sourceDir
  }

  async createBackup(): Promise<void> {
    console.log('Creating backup of current version...')
    
    await fs.mkdir(this.backupDir, { recursive: true })
    
    const backupPath = path.join(this.backupDir, `wilson-${this.currentVersion}-${Date.now()}`)
    const wilsonRoot = path.join(__dirname, '../..')
    
    execSync(`cp -r "${wilsonRoot}" "${backupPath}"`, { stdio: 'ignore' })
    console.log(`Backup created at ${backupPath}`)
  }

  async applyUpdate(sourceDir: string): Promise<void> {
    console.log('Applying update...')
    
    const wilsonRoot = path.join(__dirname, '../..')
    
    // Stop any running processes
    try {
      execSync('pkill -f wilson', { stdio: 'ignore' })
    } catch {
      // Process might not be running
    }

    // Replace source files
    await fs.rm(path.join(wilsonRoot, 'src'), { recursive: true, force: true })
    execSync(`cp -r "${sourceDir}/src" "${wilsonRoot}/"`, { stdio: 'ignore' })
    
    // Update package.json
    execSync(`cp "${sourceDir}/package.json" "${wilsonRoot}/"`, { stdio: 'ignore' })
    
    // Reinstall dependencies and rebuild
    console.log('Rebuilding Wilson...')
    execSync('bun install', { cwd: wilsonRoot, stdio: 'ignore' })
    execSync('bun run build', { cwd: wilsonRoot, stdio: 'ignore' })
    
    console.log('Update applied successfully!')
  }

  async performUpdate(release: WilsonRelease): Promise<void> {
    try {
      // Create backup
      await this.createBackup()
      
      // Download and extract
      const tarPath = await this.downloadUpdate(release)
      const sourceDir = await this.extractUpdate(tarPath)
      
      // Apply update
      await this.applyUpdate(sourceDir)
      
      // Cleanup
      await fs.rm(path.dirname(tarPath), { recursive: true, force: true })
      
      console.log(`\n✅ Successfully updated Wilson to v${release.version}`)
      console.log('Restart Wilson to use the new version.')
      
    } catch (error) {
      console.error('❌ Update failed:', error)
      console.log('Your previous version has been preserved.')
      throw error
    }
  }

  async autoUpdate(): Promise<boolean> {
    const release = await this.checkForUpdates()
    if (!release) return false

    console.log(`\n🔄 New Wilson version available: v${release.version} (current: v${this.currentVersion})`)
    
    // Auto-update without prompting in CI/automated environments
    if (process.env.WILSON_AUTO_UPDATE === 'true') {
      await this.performUpdate(release)
      return true
    }

    // In interactive mode, just notify
    console.log('Run `wilson update` to install the latest version.')
    return false
  }

  async interactiveUpdate(): Promise<void> {
    const release = await this.checkForUpdates()
    
    if (!release) {
      console.log(`Wilson is up to date (v${this.currentVersion})`)
      return
    }

    console.log(`\nAvailable: Wilson v${release.version} (current: v${this.currentVersion})`)
    
    if (release.changelog) {
      console.log('\nChanges:')
      console.log(release.changelog)
    }

    // In a real CLI, you'd use a prompt library here
    console.log('\nStarting update...')
    await this.performUpdate(release)
  }
}

export const updater = new WilsonUpdater()