/**
 * Boot Image Patcher
 * Orchestrates magiskboot for boot image manipulation
 *
 * Based on PixelFlasher's boot patching logic (modules.py)
 */

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';
import { BinaryManager } from './binary-manager.js';

// Boot image component types
export interface BootImageComponents {
  kernel?: string;
  ramdisk?: string;
  second?: string;
  dtb?: string;
  extra?: string;
  recoveryDtbo?: string;
  kernelDtb?: string;
}

export interface BootImageInfo {
  format: 'android' | 'chromeos' | 'unknown';
  headerVersion: number;
  kernelSize: number;
  ramdiskSize: number;
  secondSize: number;
  pageSize: number;
  osVersion: string;
  osPatchLevel: string;
  cmdline: string;
  hasRamdisk: boolean;
  hasDtb: boolean;
  sha1: string;
  components: BootImageComponents;
}

export interface PatchOptions {
  keepVerity?: boolean;
  keepEncryption?: boolean;
  patchVbmetaFlag?: boolean;
  legacySAR?: boolean;
}

export interface PatchResult {
  success: boolean;
  originalPath: string;
  patchedPath: string;
  backupPath?: string;
  sha1Original: string;
  sha1Patched: string;
  patchMethod: string;
  details: string;
}

// Boot cache directory
const BOOT_CACHE_DIR = path.join(os.homedir(), '.android-debug-mcp', 'boot-cache');

export class BootPatcher {
  /**
   * Get boot image information using magiskboot
   */
  static async getBootInfo(bootImagePath: string): Promise<BootImageInfo> {
    // Validate path
    this.validatePath(bootImagePath);

    if (!fsSync.existsSync(bootImagePath)) {
      throw new Error(`Boot image not found: ${bootImagePath}`);
    }

    // Create temp directory for unpacking
    const tempDir = await this.createTempDir('bootinfo');

    try {
      // Copy boot image to temp dir
      const tempBoot = path.join(tempDir, 'boot.img');
      await fs.copyFile(bootImagePath, tempBoot);

      // Run magiskboot unpack
      const result = await BinaryManager.execute('magiskboot', ['unpack', '-h', tempBoot], {
        cwd: tempDir,
        timeout: 60000,
      });

      // Parse magiskboot output
      const info = this.parseBootInfo(result.stdout + result.stderr);

      // Calculate SHA1
      const sha1 = await this.calculateSHA1(bootImagePath);
      info.sha1 = sha1;

      // Check for components
      const components: BootImageComponents = {};
      const possibleComponents = [
        ['kernel', 'kernel'],
        ['ramdisk.cpio', 'ramdisk'],
        ['second', 'second'],
        ['dtb', 'dtb'],
        ['extra', 'extra'],
        ['recovery_dtbo', 'recoveryDtbo'],
        ['kernel_dtb', 'kernelDtb'],
      ];

      for (const [filename, key] of possibleComponents) {
        const componentPath = path.join(tempDir, filename);
        if (fsSync.existsSync(componentPath)) {
          components[key as keyof BootImageComponents] = componentPath;
        }
      }

      info.components = components;
      info.hasRamdisk = !!components.ramdisk;
      info.hasDtb = !!components.dtb;

      return info;
    } finally {
      // Cleanup temp directory
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Unpack boot image to directory
   */
  static async unpack(bootImagePath: string, outputDir: string): Promise<{
    success: boolean;
    components: BootImageComponents;
    headerInfo: string;
  }> {
    this.validatePath(bootImagePath);
    this.validatePath(outputDir);

    if (!fsSync.existsSync(bootImagePath)) {
      throw new Error(`Boot image not found: ${bootImagePath}`);
    }

    // Create output directory
    await fs.mkdir(outputDir, { recursive: true });

    // Copy boot image to output dir
    const bootCopy = path.join(outputDir, 'boot.img');
    await fs.copyFile(bootImagePath, bootCopy);

    // Run magiskboot unpack
    const result = await BinaryManager.execute('magiskboot', ['unpack', bootCopy], {
      cwd: outputDir,
      timeout: 60000,
    });

    if (result.exitCode !== 0 && !result.stdout.includes('HEADER_VER')) {
      throw new Error(`Failed to unpack boot image: ${result.stderr}`);
    }

    // Find extracted components
    const components: BootImageComponents = {};
    const files = await fs.readdir(outputDir);

    for (const file of files) {
      const filePath = path.join(outputDir, file);
      if (file === 'kernel') components.kernel = filePath;
      else if (file === 'ramdisk.cpio') components.ramdisk = filePath;
      else if (file === 'second') components.second = filePath;
      else if (file === 'dtb') components.dtb = filePath;
      else if (file === 'extra') components.extra = filePath;
      else if (file === 'recovery_dtbo') components.recoveryDtbo = filePath;
      else if (file === 'kernel_dtb') components.kernelDtb = filePath;
    }

    return {
      success: true,
      components,
      headerInfo: result.stdout + result.stderr,
    };
  }

  /**
   * Repack boot image from components
   */
  static async repack(workDir: string, outputPath: string): Promise<{
    success: boolean;
    outputPath: string;
    sha1: string;
  }> {
    this.validatePath(workDir);
    this.validatePath(outputPath);

    if (!fsSync.existsSync(workDir)) {
      throw new Error(`Work directory not found: ${workDir}`);
    }

    // Check for required files
    const bootImg = path.join(workDir, 'boot.img');
    if (!fsSync.existsSync(bootImg)) {
      throw new Error('boot.img not found in work directory. Unpack first.');
    }

    // Run magiskboot repack
    const result = await BinaryManager.execute('magiskboot', ['repack', bootImg], {
      cwd: workDir,
      timeout: 120000,
    });

    if (result.exitCode !== 0) {
      throw new Error(`Failed to repack boot image: ${result.stderr}`);
    }

    // Find the repacked image (new-boot.img)
    const repackedPath = path.join(workDir, 'new-boot.img');
    if (!fsSync.existsSync(repackedPath)) {
      throw new Error('Repacked boot image not created');
    }

    // Move to output path
    await fs.copyFile(repackedPath, outputPath);

    // Calculate SHA1
    const sha1 = await this.calculateSHA1(outputPath);

    return {
      success: true,
      outputPath,
      sha1,
    };
  }

  /**
   * Backup stock boot image to cache
   */
  static async backupStock(bootImagePath: string, deviceInfo?: {
    model?: string;
    codename?: string;
    androidVersion?: string;
  }): Promise<{
    cached: boolean;
    cachePath: string;
    sha1: string;
    isNew: boolean;
  }> {
    this.validatePath(bootImagePath);

    if (!fsSync.existsSync(bootImagePath)) {
      throw new Error(`Boot image not found: ${bootImagePath}`);
    }

    // Calculate SHA1 for fingerprinting
    const sha1 = await this.calculateSHA1(bootImagePath);

    // Create cache directory for this boot image
    const cacheDir = path.join(BOOT_CACHE_DIR, sha1);
    const cachedBootPath = path.join(cacheDir, 'boot.img');
    const metadataPath = path.join(cacheDir, 'metadata.json');

    // Check if already cached
    if (fsSync.existsSync(cachedBootPath)) {
      return {
        cached: true,
        cachePath: cachedBootPath,
        sha1,
        isNew: false,
      };
    }

    // Create cache directory and copy boot image
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.copyFile(bootImagePath, cachedBootPath);

    // Save metadata
    const metadata = {
      sha1,
      originalPath: bootImagePath,
      cachedAt: new Date().toISOString(),
      device: deviceInfo || {},
    };
    await fs.writeFile(metadataPath, JSON.stringify(metadata, null, 2));

    return {
      cached: true,
      cachePath: cachedBootPath,
      sha1,
      isNew: true,
    };
  }

  /**
   * Get cached stock boot image by SHA1
   */
  static async getStockFromCache(sha1: string): Promise<string | null> {
    const cachedPath = path.join(BOOT_CACHE_DIR, sha1, 'boot.img');
    if (fsSync.existsSync(cachedPath)) {
      return cachedPath;
    }
    return null;
  }

  /**
   * List all cached boot images
   */
  static async listCachedBoots(): Promise<Array<{
    sha1: string;
    cachedAt: string;
    device: Record<string, string>;
  }>> {
    const cached: Array<{
      sha1: string;
      cachedAt: string;
      device: Record<string, string>;
    }> = [];

    if (!fsSync.existsSync(BOOT_CACHE_DIR)) {
      return cached;
    }

    const entries = await fs.readdir(BOOT_CACHE_DIR, { withFileTypes: true });

    for (const entry of entries) {
      if (entry.isDirectory()) {
        const metadataPath = path.join(BOOT_CACHE_DIR, entry.name, 'metadata.json');
        try {
          const content = await fs.readFile(metadataPath, 'utf-8');
          const metadata = JSON.parse(content);
          cached.push({
            sha1: entry.name,
            cachedAt: metadata.cachedAt,
            device: metadata.device || {},
          });
        } catch {
          // Skip invalid cache entries
        }
      }
    }

    return cached;
  }

  /**
   * Patch boot image with Magisk
   * Note: This creates a patched boot image but does NOT flash it
   */
  static async patchWithMagisk(
    bootImagePath: string,
    magiskApkPath: string,
    outputPath: string,
    options: PatchOptions = {}
  ): Promise<PatchResult> {
    this.validatePath(bootImagePath);
    this.validatePath(magiskApkPath);
    this.validatePath(outputPath);

    if (!fsSync.existsSync(bootImagePath)) {
      throw new Error(`Boot image not found: ${bootImagePath}`);
    }
    if (!fsSync.existsSync(magiskApkPath)) {
      throw new Error(`Magisk APK not found: ${magiskApkPath}`);
    }

    const sha1Original = await this.calculateSHA1(bootImagePath);

    // Validate boot image format
    if (!(await this.isValidBootImage(bootImagePath))) {
      throw new Error(`Not a valid Android boot image: ${bootImagePath}`);
    }

    // Validate APK format
    const apkValidation = await this.isValidAPK(magiskApkPath);
    if (!apkValidation.valid) {
      throw new Error(`Invalid Magisk APK: ${apkValidation.error}`);
    }

    // CRITICAL: Backup stock BEFORE any modifications
    await this.backupStock(bootImagePath).catch((err) => {
      console.error(`Warning: Failed to backup stock boot: ${err.message}`);
    });

    // Create temp directory
    const tempDir = await this.createTempDir('magisk-patch');

    try {
      // Copy boot image
      const tempBoot = path.join(tempDir, 'boot.img');
      await fs.copyFile(bootImagePath, tempBoot);

      // Unpack boot image
      await BinaryManager.execute('magiskboot', ['unpack', tempBoot], {
        cwd: tempDir,
        timeout: 60000,
      });

      // Extract Magisk files from APK (it's a zip)
      const magiskDir = path.join(tempDir, 'magisk');
      await fs.mkdir(magiskDir, { recursive: true });

      // Use unzip to extract lib/x86_64 or lib/arm64-v8a
      const { Extract: unzip } = await import('unzipper');
      const { createReadStream } = await import('fs');

      await new Promise<void>((resolve, reject) => {
        createReadStream(magiskApkPath)
          .pipe(unzip({ path: magiskDir }))
          .on('close', resolve)
          .on('error', reject);
      });

      // Find magiskinit binary (architecture-specific)
      const arch = os.arch() === 'arm64' ? 'arm64-v8a' : 'x86_64';
      const magiskinitPath = path.join(magiskDir, 'lib', arch, 'libmagiskinit.so');

      if (!fsSync.existsSync(magiskinitPath)) {
        throw new Error(`Magisk init not found in APK for architecture: ${arch}`);
      }

      // Patch ramdisk with magisk
      const ramdiskPath = path.join(tempDir, 'ramdisk.cpio');
      if (fsSync.existsSync(ramdiskPath)) {
        // Use magiskboot to patch ramdisk
        await BinaryManager.execute('magiskboot', [
          'cpio', ramdiskPath,
          'add 0750 init', magiskinitPath,
        ], {
          cwd: tempDir,
          timeout: 60000,
        });
      }

      // Handle options
      if (!options.keepVerity) {
        // Patch fstab to remove verity
        await BinaryManager.execute('magiskboot', ['cpio', ramdiskPath, 'patch'], {
          cwd: tempDir,
          timeout: 60000,
        }).catch(() => {}); // Ignore if no fstab
      }

      // Repack boot image
      await BinaryManager.execute('magiskboot', ['repack', tempBoot], {
        cwd: tempDir,
        timeout: 120000,
      });

      const patchedTempPath = path.join(tempDir, 'new-boot.img');
      if (!fsSync.existsSync(patchedTempPath)) {
        throw new Error('Patched boot image was not created');
      }

      // Copy to output
      await fs.copyFile(patchedTempPath, outputPath);

      const sha1Patched = await this.calculateSHA1(outputPath);

      // Verify copy integrity
      const patchedSourceHash = await this.calculateSHA1(patchedTempPath);
      if (patchedSourceHash !== sha1Patched) {
        throw new Error('File copy verification failed - patched image may be corrupted');
      }

      return {
        success: true,
        originalPath: bootImagePath,
        patchedPath: outputPath,
        backupPath: path.join(BOOT_CACHE_DIR, sha1Original, 'boot.img'),
        sha1Original,
        sha1Patched,
        patchMethod: 'magisk',
        details: `Patched with Magisk. Options: keepVerity=${options.keepVerity || false}`,
      };
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /**
   * Parse magiskboot output to extract boot image info
   */
  private static parseBootInfo(output: string): BootImageInfo {
    const info: BootImageInfo = {
      format: 'unknown',
      headerVersion: 0,
      kernelSize: 0,
      ramdiskSize: 0,
      secondSize: 0,
      pageSize: 2048,
      osVersion: '',
      osPatchLevel: '',
      cmdline: '',
      hasRamdisk: false,
      hasDtb: false,
      sha1: '',
      components: {},
    };

    // Parse format
    if (output.includes('CHROMEOS')) {
      info.format = 'chromeos';
    } else if (output.includes('HEADER_VER')) {
      info.format = 'android';
    }

    // Parse header version
    const headerMatch = output.match(/HEADER_VER\s*\[(\d+)\]/);
    if (headerMatch) {
      info.headerVersion = parseInt(headerMatch[1], 10);
    }

    // Parse kernel size
    const kernelMatch = output.match(/KERNEL_SZ\s*\[(\d+)\]/);
    if (kernelMatch) {
      info.kernelSize = parseInt(kernelMatch[1], 10);
    }

    // Parse ramdisk size
    const ramdiskMatch = output.match(/RAMDISK_SZ\s*\[(\d+)\]/);
    if (ramdiskMatch) {
      info.ramdiskSize = parseInt(ramdiskMatch[1], 10);
    }

    // Parse page size
    const pageMatch = output.match(/PAGE_SZ\s*\[(\d+)\]/);
    if (pageMatch) {
      info.pageSize = parseInt(pageMatch[1], 10);
    }

    // Parse OS version
    const osVerMatch = output.match(/OS_VERSION\s*\[([^\]]+)\]/);
    if (osVerMatch) {
      info.osVersion = osVerMatch[1];
    }

    // Parse patch level
    const patchMatch = output.match(/OS_PATCH_LEVEL\s*\[([^\]]+)\]/);
    if (patchMatch) {
      info.osPatchLevel = patchMatch[1];
    }

    // Parse cmdline
    const cmdlineMatch = output.match(/CMDLINE\s*\[([^\]]*)\]/);
    if (cmdlineMatch) {
      info.cmdline = cmdlineMatch[1];
    }

    return info;
  }

  /**
   * Calculate SHA1 hash of a file
   */
  private static async calculateSHA1(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha1');
      const stream = fsSync.createReadStream(filePath);
      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Create a temporary directory atomically (using mkdtemp)
   */
  private static async createTempDir(prefix: string): Promise<string> {
    // Use mkdtemp which is atomic and secure (no TOCTOU)
    return await fs.mkdtemp(path.join(os.tmpdir(), `${prefix}-`));
  }

  /**
   * Verify boot image magic bytes
   */
  static async isValidBootImage(filePath: string): Promise<boolean> {
    const fd = await fs.open(filePath, 'r');
    try {
      const header = Buffer.alloc(8);
      await fd.read(header, 0, 8, 0);
      // ANDROID! magic (standard) or CHROMEOS magic
      const magic = header.toString('ascii', 0, 8);
      return magic === 'ANDROID!' || magic.startsWith('CHROMEOS');
    } finally {
      await fd.close();
    }
  }

  /**
   * Validate APK file format (basic check)
   */
  static async isValidAPK(filePath: string): Promise<{ valid: boolean; error?: string }> {
    const stats = await fs.stat(filePath);

    // Size check (1MB to 500MB)
    if (stats.size < 1_000_000 || stats.size > 500_000_000) {
      return { valid: false, error: 'APK size unreasonable (expected 1MB-500MB)' };
    }

    // Check ZIP magic bytes (PK..)
    const fd = await fs.open(filePath, 'r');
    try {
      const header = Buffer.alloc(4);
      await fd.read(header, 0, 4, 0);
      if (!header.equals(Buffer.from([0x50, 0x4B, 0x03, 0x04]))) {
        return { valid: false, error: 'Not a valid ZIP/APK file (bad magic bytes)' };
      }
    } finally {
      await fd.close();
    }

    return { valid: true };
  }

  /**
   * Validate file path for security
   */
  private static validatePath(filePath: string): void {
    if (filePath.includes('..') || filePath.includes('\0')) {
      throw new Error(`Invalid path: ${filePath}`);
    }

    const resolved = path.resolve(filePath);
    const blocked = ['/etc', '/proc', '/sys', '/dev', '/root', '/boot'];

    for (const b of blocked) {
      if (resolved.startsWith(b + '/') || resolved === b) {
        throw new Error(`Access to ${b} is not allowed`);
      }
    }
  }
}
