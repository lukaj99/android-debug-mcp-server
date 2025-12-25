/**
 * Binary Manager - Auto-download and manage external tool binaries
 *
 * Handles downloading and managing:
 * - payload-dumper-go (OTA extraction)
 * - magiskboot (boot image patching) - Phase 4
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as https from 'https';
import * as crypto from 'crypto';
import { createWriteStream, createReadStream } from 'fs';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { Extract as unzip } from 'unzipper';
import * as tar from 'tar';

const execFileAsync = promisify(execFile);

export type Platform = 'darwin' | 'linux' | 'windows';
export type Architecture = 'amd64' | 'arm64';

export interface BinaryInfo {
  name: string;
  version: string;
  path: string;
  installed: boolean;
  lastChecked?: string;
}

export interface DownloadableToolConfig {
  name: string;
  githubRepo: string;
  releaseTag: string;
  binaryName: string;
  assetPattern: (platform: Platform, arch: Architecture) => string;
  checksums?: Record<string, string>;
}

export class BinaryManager {
  private static readonly INSTALL_DIR = path.join(os.homedir(), '.android-debug-mcp', 'tools');
  private static readonly CHECKSUMS_FILE = path.join(this.INSTALL_DIR, 'checksums.json');

  // Tool configurations
  private static readonly TOOLS: Record<string, DownloadableToolConfig> = {
    'payload-dumper-go': {
      name: 'payload-dumper-go',
      githubRepo: 'ssut/payload-dumper-go',
      releaseTag: 'latest',
      binaryName: 'payload-dumper-go',
      assetPattern: (platform, arch) => {
        const osName = platform === 'darwin' ? 'darwin' : platform === 'windows' ? 'windows' : 'linux';
        const archStr = arch === 'arm64' ? 'arm64' : 'amd64';
        const ext = platform === 'windows' ? '.exe' : '';
        return `payload-dumper-go_${osName}_${archStr}${ext}`;
      },
    },
    'magiskboot': {
      name: 'magiskboot',
      // Using nickel-chromium/magiskboot_build for standalone prebuilt binaries
      githubRepo: 'nickel-chromium/magiskboot_build',
      releaseTag: 'latest',
      binaryName: 'magiskboot',
      assetPattern: (platform, arch) => {
        // Format: magiskboot-linux-x86_64.tar.xz, magiskboot-darwin-arm64.tar.xz
        const osName = platform === 'darwin' ? 'darwin' : platform === 'windows' ? 'windows' : 'linux';
        const archStr = arch === 'arm64' ? 'arm64' : 'x86_64';
        return `magiskboot-${osName}-${archStr}`;
      },
    },
  };

  /**
   * Get the installation directory
   */
  static getInstallDir(): string {
    return this.INSTALL_DIR;
  }

  /**
   * Detect the operating system
   */
  static detectOS(): Platform {
    const platform = os.platform();
    if (platform === 'darwin') return 'darwin';
    if (platform === 'linux') return 'linux';
    if (platform === 'win32') return 'windows';
    return 'linux';
  }

  /**
   * Detect CPU architecture
   */
  static detectArch(): Architecture {
    const arch = os.arch();
    if (arch === 'arm64' || arch === 'aarch64') return 'arm64';
    return 'amd64';
  }

  /**
   * Get path to a specific tool binary
   */
  static getBinaryPath(toolName: string): string | null {
    const config = this.TOOLS[toolName];
    if (!config) return null;

    const platform = this.detectOS();
    const extension = platform === 'windows' ? '.exe' : '';
    const binaryPath = path.join(this.INSTALL_DIR, toolName, `${config.binaryName}${extension}`);

    if (fsSync.existsSync(binaryPath)) {
      return binaryPath;
    }
    return null;
  }

  /**
   * Check if a tool is installed
   */
  static isInstalled(toolName: string): boolean {
    return this.getBinaryPath(toolName) !== null;
  }

  /**
   * Get tool version if installed (uses execFile for safety)
   */
  static async getVersion(toolName: string): Promise<string | null> {
    const binaryPath = this.getBinaryPath(toolName);
    if (!binaryPath) return null;

    try {
      // Use execFile (safe, no shell interpretation)
      const { stdout } = await execFileAsync(binaryPath, ['--version']);
      return stdout.trim().split('\n')[0];
    } catch {
      try {
        // Try alternate version flag
        const { stdout } = await execFileAsync(binaryPath, ['-v']);
        return stdout.trim().split('\n')[0];
      } catch {
        return 'unknown';
      }
    }
  }

  /**
   * Download file from URL with redirect following
   */
  private static async downloadFile(url: string, destinationPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = https.get(url, (response) => {
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
      });

      request.on('error', reject);
      request.setTimeout(60000, () => {
        request.destroy();
        reject(new Error('Download timed out'));
      });
    });
  }

  /**
   * Get latest release info from GitHub
   */
  private static async getLatestRelease(repo: string): Promise<{
    tagName: string;
    assets: Array<{ name: string; browserDownloadUrl: string }>;
  }> {
    return new Promise((resolve, reject) => {
      const options = {
        hostname: 'api.github.com',
        path: `/repos/${repo}/releases/latest`,
        headers: {
          'User-Agent': 'android-debug-mcp-server',
          'Accept': 'application/vnd.github.v3+json',
        },
      };

      https.get(options, (response) => {
        let data = '';
        response.on('data', (chunk) => { data += chunk; });
        response.on('end', () => {
          try {
            const release = JSON.parse(data);
            if (release.message) {
              reject(new Error(`GitHub API error: ${release.message}`));
              return;
            }
            resolve({
              tagName: release.tag_name,
              assets: release.assets.map((a: { name: string; browser_download_url: string }) => ({
                name: a.name,
                browserDownloadUrl: a.browser_download_url,
              })),
            });
          } catch (error) {
            reject(new Error(`Failed to parse GitHub response: ${error}`));
          }
        });
      }).on('error', reject);
    });
  }

  /**
   * Calculate SHA256 hash of a file
   */
  private static async calculateSHA256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Make a file executable (Unix-like systems)
   */
  private static async makeExecutable(filePath: string): Promise<void> {
    if (this.detectOS() !== 'windows') {
      await fs.chmod(filePath, 0o755);
    }
  }

  /**
   * Download and install a tool
   */
  static async downloadAndInstall(toolName: string, force: boolean = false): Promise<string> {
    const config = this.TOOLS[toolName];
    if (!config) {
      throw new Error(`Unknown tool: ${toolName}. Available: ${Object.keys(this.TOOLS).join(', ')}`);
    }

    // Check if already installed
    if (!force && this.isInstalled(toolName)) {
      const binaryPath = this.getBinaryPath(toolName);
      return `${toolName} is already installed at: ${binaryPath}`;
    }

    const platform = this.detectOS();
    const arch = this.detectArch();
    const toolDir = path.join(this.INSTALL_DIR, toolName);

    try {
      // Create installation directory
      await fs.mkdir(toolDir, { recursive: true });

      console.error(`Downloading ${toolName} for ${platform}/${arch}...`);

      // Get latest release
      const release = await this.getLatestRelease(config.githubRepo);
      console.error(`Latest version: ${release.tagName}`);

      // Find matching asset
      const assetPattern = config.assetPattern(platform, arch);
      const asset = release.assets.find(a =>
        a.name.toLowerCase().includes(assetPattern.toLowerCase()) ||
        a.name.toLowerCase().includes(platform) && a.name.toLowerCase().includes(arch === 'arm64' ? 'arm64' : 'amd64')
      );

      if (!asset) {
        // Try alternative patterns
        const altAsset = release.assets.find(a => {
          const name = a.name.toLowerCase();
          const hasOs = name.includes(platform) || (platform === 'darwin' && name.includes('macos'));
          const hasArch = name.includes(arch) || (arch === 'amd64' && (name.includes('x86_64') || name.includes('x64')));
          return hasOs && hasArch;
        });

        if (!altAsset) {
          const available = release.assets.map(a => a.name).join(', ');
          throw new Error(
            `No matching binary found for ${platform}/${arch}.\n` +
            `Looking for: ${assetPattern}\n` +
            `Available assets: ${available}`
          );
        }

        console.error(`Using alternative asset: ${altAsset.name}`);
        return await this.downloadAsset(altAsset, toolDir, config, platform);
      }

      return await this.downloadAsset(asset, toolDir, config, platform);
    } catch (error) {
      throw new Error(`Failed to install ${toolName}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Download and extract an asset
   */
  private static async downloadAsset(
    asset: { name: string; browserDownloadUrl: string },
    toolDir: string,
    config: DownloadableToolConfig,
    platform: Platform
  ): Promise<string> {
    const downloadPath = path.join(toolDir, asset.name);
    const extension = platform === 'windows' ? '.exe' : '';
    const binaryPath = path.join(toolDir, `${config.binaryName}${extension}`);

    console.error(`Downloading: ${asset.name}`);
    await this.downloadFile(asset.browserDownloadUrl, downloadPath);
    console.error('Download complete.');

    // Handle different archive types
    if (asset.name.endsWith('.tar.gz') || asset.name.endsWith('.tgz')) {
      console.error('Extracting tar.gz...');
      await tar.extract({
        file: downloadPath,
        cwd: toolDir,
      });
      await fs.unlink(downloadPath);
    } else if (asset.name.endsWith('.tar.xz') || asset.name.endsWith('.txz')) {
      console.error('Extracting tar.xz...');
      // Use tar with xz decompression (requires xz utils on system)
      try {
        await execFileAsync('tar', ['-xJf', downloadPath, '-C', toolDir]);
      } catch {
        // Fallback: try with --use-compress-program
        await execFileAsync('tar', ['--use-compress-program=xz', '-xf', downloadPath, '-C', toolDir]);
      }
      await fs.unlink(downloadPath);
    } else if (asset.name.endsWith('.zip')) {
      console.error('Extracting zip...');
      const readStream = createReadStream(downloadPath);
      await new Promise<void>((resolve, reject) => {
        readStream.pipe(unzip({ path: toolDir }))
          .on('close', resolve)
          .on('error', reject);
      });
      await fs.unlink(downloadPath);
    } else if (asset.name.endsWith('.exe') || !asset.name.includes('.')) {
      // Direct binary download
      if (downloadPath !== binaryPath) {
        await fs.rename(downloadPath, binaryPath);
      }
    }

    // Find and set up the binary
    const files = await fs.readdir(toolDir);
    const binaryFile = files.find(f =>
      f.includes(config.binaryName) &&
      (platform === 'windows' ? f.endsWith('.exe') : !f.endsWith('.exe'))
    );

    if (binaryFile && path.join(toolDir, binaryFile) !== binaryPath) {
      await fs.rename(path.join(toolDir, binaryFile), binaryPath);
    }

    // Make executable
    await this.makeExecutable(binaryPath);
    console.error('Binary installed and marked as executable.');

    // Verify installation
    if (!fsSync.existsSync(binaryPath)) {
      throw new Error(`Installation verification failed: binary not found at ${binaryPath}`);
    }

    // Save checksums
    const hash = await this.calculateSHA256(binaryPath);
    await this.saveChecksum(config.name, hash);

    return `✓ ${config.name} installed successfully!\n\nPath: ${binaryPath}\nSHA256: ${hash}`;
  }

  /**
   * Save checksum to checksums file
   */
  private static async saveChecksum(toolName: string, hash: string): Promise<void> {
    let checksums: Record<string, { hash: string; timestamp: string }> = {};

    try {
      const content = await fs.readFile(this.CHECKSUMS_FILE, 'utf-8');
      checksums = JSON.parse(content);
    } catch {
      // File doesn't exist or is invalid
    }

    checksums[toolName] = {
      hash,
      timestamp: new Date().toISOString(),
    };

    await fs.mkdir(path.dirname(this.CHECKSUMS_FILE), { recursive: true });
    await fs.writeFile(this.CHECKSUMS_FILE, JSON.stringify(checksums, null, 2));
  }

  /**
   * Get all installed tools status
   */
  static async getStatus(): Promise<Record<string, BinaryInfo>> {
    const status: Record<string, BinaryInfo> = {};

    for (const [name, config] of Object.entries(this.TOOLS)) {
      const binaryPath = this.getBinaryPath(name);
      const version = binaryPath ? await this.getVersion(name) : null;

      status[name] = {
        name: config.name,
        version: version || 'Not installed',
        path: binaryPath || '',
        installed: binaryPath !== null,
      };
    }

    return status;
  }

  /**
   * Ensure a tool is installed (download if missing)
   */
  static async ensureInstalled(toolName: string): Promise<string> {
    if (this.isInstalled(toolName)) {
      return this.getBinaryPath(toolName)!;
    }

    console.error(`\n⚠️  ${toolName} not found. Attempting automatic installation...\n`);
    await this.downloadAndInstall(toolName);

    const binaryPath = this.getBinaryPath(toolName);
    if (!binaryPath) {
      throw new Error(`Failed to install ${toolName}`);
    }

    return binaryPath;
  }

  /**
   * Execute a tool with arguments (uses execFile for safety - no shell interpretation)
   */
  static async execute(
    toolName: string,
    args: string[],
    options: { cwd?: string; timeout?: number } = {}
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const binaryPath = await this.ensureInstalled(toolName);
    const timeout = options.timeout || 300000; // 5 minutes default

    try {
      // Use execFile (safe, no shell interpretation)
      const { stdout, stderr } = await execFileAsync(binaryPath, args, {
        cwd: options.cwd,
        timeout,
        maxBuffer: 50 * 1024 * 1024, // 50MB buffer for large outputs
      });

      return {
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        exitCode: 0,
      };
    } catch (error: unknown) {
      // execFile throws on non-zero exit
      if (error && typeof error === 'object' && 'stdout' in error) {
        const execError = error as { stdout?: string; stderr?: string; code?: number };
        return {
          stdout: execError.stdout?.toString() || '',
          stderr: execError.stderr?.toString() || '',
          exitCode: execError.code || 1,
        };
      }
      throw error;
    }
  }
}
