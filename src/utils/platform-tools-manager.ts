/**
 * Platform Tools Manager - Automatic download and installation of Android Platform Tools
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import { createWriteStream, createReadStream } from 'fs';
import { Extract as unzip } from 'unzipper';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export type Platform = 'darwin' | 'linux' | 'windows';

export class PlatformToolsManager {
  private static readonly INSTALL_DIR = path.join(os.homedir(), '.android-debug-mcp');
  private static readonly PLATFORM_TOOLS_DIR = path.join(this.INSTALL_DIR, 'platform-tools');
  
  private static readonly DOWNLOAD_URLS: Record<Platform, string> = {
    darwin: 'https://dl.google.com/android/repository/platform-tools-latest-darwin.zip',
    linux: 'https://dl.google.com/android/repository/platform-tools-latest-linux.zip',
    windows: 'https://dl.google.com/android/repository/platform-tools-latest-windows.zip'
  };

  /**
   * Get the installation directory for platform-tools
   */
  static getPlatformToolsPath(): string {
    return this.PLATFORM_TOOLS_DIR;
  }

  /**
   * Get paths to ADB and Fastboot binaries
   */
  static getBinaryPaths(): { adb: string; fastboot: string } | null {
    if (!this.isInstalledSync()) {
      return null;
    }

    const platform = this.detectOS();
    const extension = platform === 'windows' ? '.exe' : '';
    
    return {
      adb: path.join(this.PLATFORM_TOOLS_DIR, 'platform-tools', `adb${extension}`),
      fastboot: path.join(this.PLATFORM_TOOLS_DIR, 'platform-tools', `fastboot${extension}`)
    };
  }

  /**
   * Check if platform-tools are already installed
   */
  static isInstalledSync(): boolean {
    try {
      const platform = this.detectOS();
      const extension = platform === 'windows' ? '.exe' : '';
      const adbPath = path.join(this.PLATFORM_TOOLS_DIR, 'platform-tools', `adb${extension}`);
      const fastbootPath = path.join(this.PLATFORM_TOOLS_DIR, 'platform-tools', `fastboot${extension}`);
      
      // Check if both files exist synchronously
      return fsSync.existsSync(adbPath) && fsSync.existsSync(fastbootPath);
    } catch {
      return false;
    }
  }

  /**
   * Check if platform-tools are already installed (async)
   */
  static async isInstalled(): Promise<boolean> {
    try {
      const platform = this.detectOS();
      const extension = platform === 'windows' ? '.exe' : '';
      const adbPath = path.join(this.PLATFORM_TOOLS_DIR, 'platform-tools', `adb${extension}`);
      const fastbootPath = path.join(this.PLATFORM_TOOLS_DIR, 'platform-tools', `fastboot${extension}`);
      
      await fs.access(adbPath, fs.constants.X_OK);
      await fs.access(fastbootPath, fs.constants.X_OK);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Detect the operating system
   */
  static detectOS(): Platform {
    const platform = os.platform();
    
    if (platform === 'darwin') return 'darwin';
    if (platform === 'linux') return 'linux';
    if (platform === 'win32') return 'windows';
    
    // Default to linux for unknown Unix-like systems
    return 'linux';
  }

  /**
   * Get the download URL for the current platform
   */
  static getDownloadUrl(): string {
    const platform = this.detectOS();
    return this.DOWNLOAD_URLS[platform];
  }

  /**
   * Download a file from a URL
   */
  private static async downloadFile(url: string, destinationPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      https.get(url, (response) => {
        // Follow redirects
        if (response.statusCode === 301 || response.statusCode === 302) {
          if (response.headers.location) {
            this.downloadFile(response.headers.location, destinationPath)
              .then(resolve)
              .catch(reject);
            return;
          }
        }

        if (response.statusCode !== 200) {
          reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
          return;
        }

        const fileStream = createWriteStream(destinationPath);
        response.pipe(fileStream);

        fileStream.on('finish', () => {
          fileStream.close();
          resolve();
        });

        fileStream.on('error', (error) => {
          fs.unlink(destinationPath).catch(() => {});
          reject(error);
        });
      }).on('error', reject);
    });
  }

  /**
   * Extract a zip file
   */
  private static async extractZip(zipPath: string, destination: string): Promise<void> {
    await fs.mkdir(destination, { recursive: true });
    
    const readStream = createReadStream(zipPath);
    const unzipStream = readStream.pipe(unzip({ path: destination }));
    
    return new Promise((resolve, reject) => {
      unzipStream.on('close', resolve);
      unzipStream.on('error', reject);
    });
  }

  /**
   * Make binaries executable (Unix-like systems only)
   */
  private static async makeExecutable(filePath: string): Promise<void> {
    try {
      await fs.chmod(filePath, 0o755);
    } catch (error) {
      // Ignore errors on Windows
      if (this.detectOS() !== 'windows') {
        throw error;
      }
    }
  }

  /**
   * Download and install Android Platform Tools
   */
  static async downloadAndInstall(force: boolean = false): Promise<string> {
    // Check if already installed
    if (!force && await this.isInstalled()) {
      return 'Platform tools are already installed at: ' + this.PLATFORM_TOOLS_DIR;
    }

    try {
      // Create installation directory
      await fs.mkdir(this.INSTALL_DIR, { recursive: true });

      // Download platform-tools
      const platform = this.detectOS();
      const url = this.getDownloadUrl();
      const zipPath = path.join(this.INSTALL_DIR, 'platform-tools.zip');

      console.error(`Downloading Android Platform Tools for ${platform}...`);
      console.error(`URL: ${url}`);
      
      await this.downloadFile(url, zipPath);
      console.error('Download complete. Extracting...');

      // Remove old installation if it exists
      try {
        await fs.rm(this.PLATFORM_TOOLS_DIR, { recursive: true, force: true });
      } catch {
        // Ignore errors if directory doesn't exist
      }

      // Extract the zip file
      await this.extractZip(zipPath, this.PLATFORM_TOOLS_DIR);
      console.error('Extraction complete.');

      // Make binaries executable on Unix-like systems
      if (platform !== 'windows') {
        const extension = '';
        const adbPath = path.join(this.PLATFORM_TOOLS_DIR, 'platform-tools', `adb${extension}`);
        const fastbootPath = path.join(this.PLATFORM_TOOLS_DIR, 'platform-tools', `fastboot${extension}`);
        
        await this.makeExecutable(adbPath);
        await this.makeExecutable(fastbootPath);
        console.error('Binaries marked as executable.');
      }

      // Clean up zip file
      await fs.unlink(zipPath);

      // Verify installation
      const binaries = this.getBinaryPaths();
      if (!binaries) {
        throw new Error('Installation verification failed: binaries not found');
      }

      return `✓ Android Platform Tools installed successfully!\n\nInstallation path: ${this.PLATFORM_TOOLS_DIR}\nADB: ${binaries.adb}\nFastboot: ${binaries.fastboot}`;
    } catch (error) {
      throw new Error(`Failed to install platform-tools: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Get installation status and information
   */
  static async getStatus(): Promise<{
    installed: boolean;
    path?: string;
    adbPath?: string;
    fastbootPath?: string;
    adbVersion?: string;
    fastbootVersion?: string;
  }> {
    const installed = await this.isInstalled();
    
    if (!installed) {
      return { installed: false };
    }

    const binaries = this.getBinaryPaths();
    if (!binaries) {
      return { installed: false };
    }

    // Try to get versions
    let adbVersion: string | undefined;
    let fastbootVersion: string | undefined;

    try {
      const { stdout: adbOut } = await execAsync(`"${binaries.adb}" version`);
      adbVersion = adbOut.trim().split('\n')[0];
    } catch {
      adbVersion = 'Unable to determine version';
    }

    try {
      const { stdout: fastbootOut } = await execAsync(`"${binaries.fastboot}" --version`);
      fastbootVersion = fastbootOut.trim().split('\n')[0];
    } catch {
      fastbootVersion = 'Unable to determine version';
    }

    return {
      installed: true,
      path: this.PLATFORM_TOOLS_DIR,
      adbPath: binaries.adb,
      fastbootPath: binaries.fastboot,
      adbVersion,
      fastbootVersion
    };
  }
}

