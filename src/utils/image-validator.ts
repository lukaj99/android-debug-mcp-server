/**
 * Image Validator
 * Validates boot images, OTA payloads, and firmware packages
 *
 * Based on PixelFlasher's validation patterns (modules.py)
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as path from 'path';
import type { ImageValidationResult, BootImageInfo } from '../types.js';

// Boot image magic bytes
const BOOT_MAGIC = Buffer.from('ANDROID!');
const VENDOR_BOOT_MAGIC = Buffer.from('VNDRBOOT');

// Boot image header offsets
const KERNEL_SIZE_OFFSET = 8;
const PAGE_SIZE_OFFSET = 36;
const HEADER_VERSION_OFFSET = 40;
const OS_VERSION_OFFSET = 44;

export class ImageValidator {
  /**
   * Validate an image file for flashing
   */
  static async validateImage(
    imagePath: string,
    expectedType?: 'boot' | 'vendor_boot' | 'vbmeta' | 'generic'
  ): Promise<ImageValidationResult> {
    const result: ImageValidationResult = {
      valid: false,
      path: imagePath,
      exists: false,
      size: 0,
      sizeHuman: '0 B',
      sha256: '',
      type: 'unknown',
      warnings: [],
      errors: [],
    };

    // Check file exists
    if (!fs.existsSync(imagePath)) {
      result.errors.push(`File not found: ${imagePath}`);
      return result;
    }

    result.exists = true;

    // Get file stats
    const stats = fs.statSync(imagePath);
    result.size = stats.size;
    result.sizeHuman = this.formatBytes(stats.size);

    // Check file is not empty
    if (stats.size === 0) {
      result.errors.push('File is empty (0 bytes)');
      return result;
    }

    // Check file is not too small
    if (stats.size < 512) {
      result.errors.push(`File too small (${result.sizeHuman}). Minimum expected: 512 bytes`);
      return result;
    }

    // Calculate SHA256
    try {
      result.sha256 = await this.calculateSHA256(imagePath);
    } catch (error) {
      result.warnings.push(`Could not calculate SHA256: ${error}`);
    }

    // Detect image type
    const detectedType = await this.detectImageType(imagePath);
    result.type = detectedType.type;

    if (detectedType.info) {
      result.bootImageInfo = detectedType.info;
    }

    // Validate against expected type
    if (expectedType && expectedType !== 'generic') {
      if (result.type !== expectedType && result.type !== 'unknown') {
        result.warnings.push(
          `Expected ${expectedType} image but detected ${result.type}`
        );
      }
    }

    // Type-specific validations
    if (result.type === 'boot' || result.type === 'vendor_boot') {
      const bootValidation = this.validateBootImage(imagePath, stats.size);
      result.warnings.push(...bootValidation.warnings);
      result.errors.push(...bootValidation.errors);
    }

    // Size warnings
    if (stats.size > 100 * 1024 * 1024) { // > 100MB
      result.warnings.push(
        `Large image file (${result.sizeHuman}). Flash operation may take longer.`
      );
    }

    // Extension check
    const ext = path.extname(imagePath).toLowerCase();
    if (ext !== '.img' && ext !== '.bin') {
      result.warnings.push(
        `Unusual file extension: ${ext}. Expected .img or .bin`
      );
    }

    // Mark as valid if no errors
    result.valid = result.errors.length === 0;

    return result;
  }

  /**
   * Detect image type from magic bytes
   */
  private static async detectImageType(imagePath: string): Promise<{
    type: 'boot' | 'vendor_boot' | 'vbmeta' | 'sparse' | 'unknown';
    info?: BootImageInfo;
  }> {
    const fd = fs.openSync(imagePath, 'r');
    const header = Buffer.alloc(64);

    try {
      fs.readSync(fd, header, 0, 64, 0);
    } finally {
      fs.closeSync(fd);
    }

    // Check for boot image magic
    if (header.subarray(0, 8).equals(BOOT_MAGIC)) {
      const info = this.parseBootHeader(header);
      return { type: 'boot', info };
    }

    // Check for vendor boot magic
    if (header.subarray(0, 8).equals(VENDOR_BOOT_MAGIC)) {
      return { type: 'vendor_boot' };
    }

    // Check for AVB/vbmeta magic (at offset 0)
    const avbMagic = header.subarray(0, 4).toString('ascii');
    if (avbMagic === 'AVB0') {
      return { type: 'vbmeta' };
    }

    // Check for sparse image magic
    const sparseMagic = header.readUInt32LE(0);
    if (sparseMagic === 0xED26FF3A) {
      return { type: 'sparse' };
    }

    return { type: 'unknown' };
  }

  /**
   * Parse boot image header
   */
  private static parseBootHeader(header: Buffer): BootImageInfo {
    const info: BootImageInfo = {
      headerVersion: 0,
      kernelSize: 0,
      ramdiskSize: 0,
      pageSize: 0,
    };

    try {
      // Header version (offset 40 for v0-v2, different for v3+)
      info.headerVersion = header.readUInt32LE(HEADER_VERSION_OFFSET);

      // Kernel size (offset 8)
      info.kernelSize = header.readUInt32LE(KERNEL_SIZE_OFFSET);

      // Ramdisk size (offset 16)
      info.ramdiskSize = header.readUInt32LE(16);

      // Page size (offset 36)
      info.pageSize = header.readUInt32LE(PAGE_SIZE_OFFSET);

      // OS version (offset 44) - encoded as (major << 25) | (minor << 18) | (patch << 11) | (year << 4) | month
      if (info.headerVersion >= 1) {
        const osVersion = header.readUInt32LE(OS_VERSION_OFFSET);
        info.osVersion = this.decodeOsVersion(osVersion);
        info.osPatchLevel = this.decodePatchLevel(osVersion);
      }

      // Command line (offset varies by version)
      // Note: Full cmdline parsing would require reading more bytes
    } catch (error) {
      // Partial parse is OK
    }

    return info;
  }

  /**
   * Decode OS version from boot image header
   */
  private static decodeOsVersion(encoded: number): string {
    const major = (encoded >> 25) & 0x7F;
    const minor = (encoded >> 18) & 0x7F;
    const patch = (encoded >> 11) & 0x7F;
    return `${major}.${minor}.${patch}`;
  }

  /**
   * Decode security patch level from boot image header
   */
  private static decodePatchLevel(encoded: number): string {
    const year = ((encoded >> 4) & 0x7F) + 2000;
    const month = encoded & 0xF;
    return `${year}-${month.toString().padStart(2, '0')}`;
  }

  /**
   * Validate boot image structure
   */
  private static validateBootImage(
    imagePath: string,
    _fileSize: number
  ): { warnings: string[]; errors: string[] } {
    const warnings: string[] = [];
    const errors: string[] = [];

    // Read header
    const fd = fs.openSync(imagePath, 'r');
    const header = Buffer.alloc(4096);

    try {
      fs.readSync(fd, header, 0, 4096, 0);
    } finally {
      fs.closeSync(fd);
    }

    // Verify magic
    if (!header.subarray(0, 8).equals(BOOT_MAGIC)) {
      errors.push('Invalid boot image magic bytes');
      return { warnings, errors };
    }

    // Check kernel size
    const kernelSize = header.readUInt32LE(8);
    if (kernelSize === 0) {
      warnings.push('Kernel size is 0 (may be boot image v3+ or unusual format)');
    }

    // Check page size
    const pageSize = header.readUInt32LE(36);
    const validPageSizes = [2048, 4096, 16384];
    if (!validPageSizes.includes(pageSize)) {
      warnings.push(`Unusual page size: ${pageSize}. Common values: 2048, 4096, 16384`);
    }

    // Check header version
    const headerVersion = header.readUInt32LE(40);
    if (headerVersion > 4) {
      warnings.push(`Unknown boot image header version: ${headerVersion}`);
    }

    return { warnings, errors };
  }

  /**
   * Check for downgrade risk between current and new firmware
   *
   * Based on PixelFlasher's downgrade detection (modules.py:5870-5883)
   */
  static checkDowngradeRisk(
    currentBuildFingerprint: string,
    newBuildFingerprint: string,
    currentSPL?: string,
    newSPL?: string
  ): {
    isDowngrade: boolean;
    riskLevel: 'none' | 'low' | 'medium' | 'high';
    warnings: string[];
  } {
    const result = {
      isDowngrade: false,
      riskLevel: 'none' as 'none' | 'low' | 'medium' | 'high',
      warnings: [] as string[],
    };

    // Extract dates from fingerprints (format: .../:YYMMDD/...)
    const currentDateMatch = currentBuildFingerprint.match(/:(\d{6})\//);
    const newDateMatch = newBuildFingerprint.match(/:(\d{6})\//);

    if (currentDateMatch && newDateMatch) {
      const currentDate = parseInt(currentDateMatch[1], 10);
      const newDate = parseInt(newDateMatch[1], 10);

      if (newDate < currentDate) {
        result.isDowngrade = true;
        result.riskLevel = 'high';
        result.warnings.push(
          `Build date downgrade detected: ${newDateMatch[1]} < ${currentDateMatch[1]}`
        );
      }
    }

    // Check SPL (Security Patch Level)
    if (currentSPL && newSPL) {
      const currentSPLDate = this.parseSPL(currentSPL);
      const newSPLDate = this.parseSPL(newSPL);

      if (currentSPLDate && newSPLDate) {
        if (newSPLDate < currentSPLDate) {
          result.isDowngrade = true;
          result.riskLevel = 'high';
          result.warnings.push(
            `Security Patch Level downgrade: ${newSPL} < ${currentSPL}. ` +
            `Anti-rollback protection may prevent boot!`
          );
        }
      }
    }

    // Compare build IDs if available
    const currentBuildId = this.extractBuildId(currentBuildFingerprint);
    const newBuildId = this.extractBuildId(newBuildFingerprint);

    if (currentBuildId && newBuildId && currentBuildId !== newBuildId) {
      // Different builds - check if potentially older
      if (result.isDowngrade) {
        result.warnings.push(
          `Build ID change with potential downgrade: ${currentBuildId} -> ${newBuildId}`
        );
      }
    }

    return result;
  }

  /**
   * Parse Security Patch Level date
   */
  private static parseSPL(spl: string): number | null {
    // Format: YYYY-MM-DD or YYYY-MM
    const match = spl.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
    if (!match) return null;

    const year = parseInt(match[1], 10);
    const month = parseInt(match[2], 10);
    const day = match[3] ? parseInt(match[3], 10) : 1;

    return year * 10000 + month * 100 + day;
  }

  /**
   * Extract build ID from fingerprint
   */
  private static extractBuildId(fingerprint: string): string | null {
    // Format: brand/product/device:version/BUILD_ID/...
    const match = fingerprint.match(/\/([A-Z0-9.]+)\//);
    return match ? match[1] : null;
  }

  /**
   * Calculate SHA256 hash of file
   */
  static async calculateSHA256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Format bytes to human-readable string
   */
  private static formatBytes(bytes: number): string {
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let unitIndex = 0;
    let value = bytes;

    while (value >= 1024 && unitIndex < units.length - 1) {
      value /= 1024;
      unitIndex++;
    }

    return `${value.toFixed(unitIndex === 0 ? 0 : 2)} ${units[unitIndex]}`;
  }

  /**
   * Verify image against expected SHA256
   */
  static async verifyChecksum(
    imagePath: string,
    expectedSha256: string
  ): Promise<{ valid: boolean; actual: string; expected: string }> {
    const actual = await this.calculateSHA256(imagePath);
    return {
      valid: actual.toLowerCase() === expectedSha256.toLowerCase(),
      actual,
      expected: expectedSha256,
    };
  }
}
