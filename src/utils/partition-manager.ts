/**
 * Partition Manager
 * Enhanced partition operations with comparison and verification
 *
 * Based on PixelFlasher's partition management patterns
 */

import * as fs from 'fs';
import * as crypto from 'crypto';
import * as zlib from 'zlib';
import * as path from 'path';
import { CommandExecutor } from './executor.js';
import { formatBytes } from './formatter.js';
import type { PartitionInfo, PartitionBackup } from '../types.js';

export interface PartitionCompareResult {
  identical: boolean;
  file1: {
    path: string;
    size: number;
    sha256: string;
  };
  file2: {
    path: string;
    size: number;
    sha256: string;
  };
  differences: {
    sizeDiff: number;
    hashMatch: boolean;
    diffRegions?: Array<{
      offset: number;
      length: number;
      description: string;
    }>;
  };
}

export interface IntegrityCheckResult {
  valid: boolean;
  partition: string;
  expectedHash: string;
  actualHash: string;
  details: {
    size: number;
    sizeHuman: string;
    timestamp: string;
  };
  error?: string;
}

export interface EnhancedPartitionBackup extends PartitionBackup {
  compressed: boolean;
  compressedSize?: number;
  compressionRatio?: string;
  metadata?: {
    deviceModel: string;
    androidVersion: string;
    buildId: string;
  };
}

export interface PartitionDetails extends PartitionInfo {
  fsType?: string;
  mountPoint?: string;
  readonly?: boolean;
  slot?: 'a' | 'b' | null;
  partitionType?: string;
  uuid?: string;
}

export class PartitionManager {
  /**
   * Compare two partition image files
   */
  /**
   * Validate file path to prevent path traversal attacks
   */
  private static validateFilePath(filePath: string): void {
    // Resolve to absolute path
    const resolved = path.resolve(filePath);

    // Check for path traversal attempts
    if (filePath.includes('..') || resolved !== path.normalize(filePath)) {
      throw new Error(`Invalid file path: ${filePath}`);
    }

    // Block access to sensitive system paths
    const blockedPaths = ['/etc', '/proc', '/sys', '/dev'];
    for (const blocked of blockedPaths) {
      if (resolved.startsWith(blocked + '/') || resolved === blocked) {
        throw new Error(`Access to ${blocked} is not allowed`);
      }
    }
  }

  static async comparePartitions(
    file1Path: string,
    file2Path: string,
    options: { detailed?: boolean } = {}
  ): Promise<PartitionCompareResult> {
    // Validate file paths to prevent path traversal
    this.validateFilePath(file1Path);
    this.validateFilePath(file2Path);

    // Validate both files exist
    if (!fs.existsSync(file1Path)) {
      throw new Error(`File not found: ${file1Path}`);
    }
    if (!fs.existsSync(file2Path)) {
      throw new Error(`File not found: ${file2Path}`);
    }

    // Get file stats and check sizes to prevent DoS
    const stats1 = fs.statSync(file1Path);
    const stats2 = fs.statSync(file2Path);
    const MAX_SIZE = 10 * 1024 * 1024 * 1024; // 10GB limit
    if (stats1.size > MAX_SIZE || stats2.size > MAX_SIZE) {
      throw new Error(`File too large. Maximum size: ${formatBytes(MAX_SIZE)}`);
    }

    // Calculate hashes
    const [hash1, hash2] = await Promise.all([
      this.calculateSHA256(file1Path),
      this.calculateSHA256(file2Path),
    ]);

    const result: PartitionCompareResult = {
      identical: hash1 === hash2,
      file1: {
        path: file1Path,
        size: stats1.size,
        sha256: hash1,
      },
      file2: {
        path: file2Path,
        size: stats2.size,
        sha256: hash2,
      },
      differences: {
        sizeDiff: Math.abs(stats1.size - stats2.size),
        hashMatch: hash1 === hash2,
      },
    };

    // If hashes don't match and detailed comparison requested, find diff regions
    if (options.detailed && !result.identical) {
      result.differences.diffRegions = await this.findDiffRegions(file1Path, file2Path);
    }

    return result;
  }

  /**
   * Find regions that differ between two files
   */
  private static async findDiffRegions(
    file1Path: string,
    file2Path: string,
    blockSize: number = 4096,
    maxRegions: number = 100
  ): Promise<Array<{ offset: number; length: number; description: string }>> {
    const regions: Array<{ offset: number; length: number; description: string }> = [];

    const fd1 = fs.openSync(file1Path, 'r');
    const fd2 = fs.openSync(file2Path, 'r');

    const stats1 = fs.statSync(file1Path);
    const stats2 = fs.statSync(file2Path);
    const minSize = Math.min(stats1.size, stats2.size);

    const buffer1 = Buffer.alloc(blockSize);
    const buffer2 = Buffer.alloc(blockSize);

    let currentDiffStart: number | null = null;
    let offset = 0;

    try {
      while (offset < minSize && regions.length < maxRegions) {
        const bytesToRead = Math.min(blockSize, minSize - offset);

        fs.readSync(fd1, buffer1, 0, bytesToRead, offset);
        fs.readSync(fd2, buffer2, 0, bytesToRead, offset);

        const blocksMatch = buffer1.subarray(0, bytesToRead).equals(buffer2.subarray(0, bytesToRead));

        if (!blocksMatch && currentDiffStart === null) {
          // Start of a diff region
          currentDiffStart = offset;
        } else if (blocksMatch && currentDiffStart !== null) {
          // End of a diff region
          regions.push({
            offset: currentDiffStart,
            length: offset - currentDiffStart,
            description: `Diff at offset 0x${currentDiffStart.toString(16)} (${formatBytes(offset - currentDiffStart)})`,
          });
          currentDiffStart = null;
        }

        offset += bytesToRead;
      }

      // Handle diff that extends to end of file
      if (currentDiffStart !== null) {
        regions.push({
          offset: currentDiffStart,
          length: offset - currentDiffStart,
          description: `Diff at offset 0x${currentDiffStart.toString(16)} to end`,
        });
      }

      // Handle size difference
      if (stats1.size !== stats2.size) {
        regions.push({
          offset: minSize,
          length: Math.abs(stats1.size - stats2.size),
          description: `Size difference: file1=${formatBytes(stats1.size)}, file2=${formatBytes(stats2.size)}`,
        });
      }
    } finally {
      fs.closeSync(fd1);
      fs.closeSync(fd2);
    }

    return regions;
  }

  /**
   * Verify partition integrity against expected hash
   */
  static async verifyPartitionIntegrity(
    imagePath: string,
    expectedHash: string,
    partitionName: string
  ): Promise<IntegrityCheckResult> {
    const result: IntegrityCheckResult = {
      valid: false,
      partition: partitionName,
      expectedHash: expectedHash.toLowerCase(),
      actualHash: '',
      details: {
        size: 0,
        sizeHuman: '0 B',
        timestamp: new Date().toISOString(),
      },
    };

    // Validate file path to prevent path traversal
    try {
      this.validateFilePath(imagePath);
    } catch (error) {
      result.error = error instanceof Error ? error.message : String(error);
      return result;
    }

    if (!fs.existsSync(imagePath)) {
      result.error = `File not found: ${imagePath}`;
      return result;
    }

    try {
      const stats = fs.statSync(imagePath);
      result.details.size = stats.size;
      result.details.sizeHuman = formatBytes(stats.size);

      result.actualHash = await this.calculateSHA256(imagePath);
      result.valid = result.actualHash.toLowerCase() === result.expectedHash.toLowerCase();
    } catch (error) {
      result.error = `Failed to verify: ${error instanceof Error ? error.message : String(error)}`;
    }

    return result;
  }

  /**
   * Get detailed partition information from device
   */
  static async getPartitionDetails(
    deviceId: string,
    partitionName: string
  ): Promise<PartitionDetails | null> {
    // Get block device path
    const linkResult = await CommandExecutor.shell(
      deviceId,
      `ls -la /dev/block/by-name/${partitionName.replace(/'/g, "'\\''")} 2>/dev/null`
    );

    if (!linkResult.success || !linkResult.stdout.includes('->')) {
      return null;
    }

    const match = linkResult.stdout.match(/-> (\/dev\/block\/[^\s]+)/);
    if (!match) {
      return null;
    }

    const blockDevice = match[1];

    // Validate block device path to prevent path traversal
    if (!blockDevice.startsWith('/dev/block/')) {
      return null;
    }
    // Ensure no path traversal or shell metacharacters
    if (blockDevice.includes('..') || /[;&|$`"'\n\r]/.test(blockDevice)) {
      return null;
    }
    // Whitelist expected block device patterns
    if (!/^\/dev\/block\/(mmcblk|sd[a-z]|nvme[0-9]|vd[a-z]|loop|dm-)[0-9a-z]*[p]?[0-9]*$/i.test(blockDevice)) {
      // Non-standard device, still allow but log warning
      console.error(`Warning: Non-standard block device: ${blockDevice}`);
    }

    // Get size
    const sizeResult = await CommandExecutor.shell(
      deviceId,
      `blockdev --getsize64 '${blockDevice.replace(/'/g, "'\\''")}' 2>/dev/null`
    );
    const sizeBytes = sizeResult.success ? parseInt(sizeResult.stdout.trim(), 10) || 0 : 0;

    // Determine slot suffix
    let slot: 'a' | 'b' | null = null;
    if (partitionName.endsWith('_a')) {
      slot = 'a';
    } else if (partitionName.endsWith('_b')) {
      slot = 'b';
    }

    // Check if readonly
    const roResult = await CommandExecutor.shell(
      deviceId,
      `blockdev --getro '${blockDevice.replace(/'/g, "'\\''")}' 2>/dev/null`
    );
    const readonly = roResult.success && roResult.stdout.trim() === '1';

    // Get filesystem type if mounted
    const mountResult = await CommandExecutor.shell(
      deviceId,
      `mount | grep '${blockDevice.replace(/'/g, "'\\''")}' 2>/dev/null`
    );

    let fsType: string | undefined;
    let mountPoint: string | undefined;

    if (mountResult.success && mountResult.stdout.trim()) {
      const mountMatch = mountResult.stdout.match(/(\S+) on (\S+) type (\S+)/);
      if (mountMatch) {
        mountPoint = mountMatch[2];
        fsType = mountMatch[3];
      }
    }

    // Determine criticality
    const criticalPartitions = [
      'boot', 'system', 'vendor', 'userdata', 'metadata',
      'vbmeta', 'bootloader', 'radio', 'modem', 'dtbo',
      'super', 'product', 'system_ext', 'odm'
    ];
    const baseName = partitionName.replace(/_[ab]$/, '');
    const critical = criticalPartitions.some(p => baseName === p || baseName.startsWith(p + '_'));

    return {
      name: partitionName,
      device: partitionName,
      blockDevice,
      sizeBytes,
      sizeHuman: formatBytes(sizeBytes),
      critical,
      slot,
      readonly,
      fsType,
      mountPoint,
    };
  }

  /**
   * List all partitions with enhanced details
   */
  static async listPartitionsDetailed(deviceId: string): Promise<PartitionDetails[]> {
    const listResult = await CommandExecutor.shell(
      deviceId,
      'ls /dev/block/by-name/ 2>/dev/null'
    );

    if (!listResult.success) {
      throw new Error('Failed to list partitions. Device may not support /dev/block/by-name/');
    }

    const partitionNames = listResult.stdout.trim().split(/\s+/).filter(Boolean);
    const partitions: PartitionDetails[] = [];

    // Process partitions in parallel batches to avoid overwhelming device
    const batchSize = 10;
    for (let i = 0; i < partitionNames.length; i += batchSize) {
      const batch = partitionNames.slice(i, i + batchSize);
      const details = await Promise.all(
        batch.map(name => this.getPartitionDetails(deviceId, name))
      );

      for (const detail of details) {
        if (detail) {
          partitions.push(detail);
        }
      }
    }

    // Sort: critical first, then by slot, then by name
    partitions.sort((a, b) => {
      if (a.critical !== b.critical) return a.critical ? -1 : 1;
      if (a.slot !== b.slot) {
        if (a.slot === 'a') return -1;
        if (b.slot === 'a') return 1;
      }
      return a.name.localeCompare(b.name);
    });

    return partitions;
  }

  /**
   * Enhanced partition dump with compression and metadata
   */
  static async dumpPartitionFull(
    deviceId: string,
    partitionName: string,
    outputPath: string,
    options: {
      compress?: boolean;
      includeMetadata?: boolean;
    } = {}
  ): Promise<EnhancedPartitionBackup> {
    // Get partition details
    const partition = await this.getPartitionDetails(deviceId, partitionName);
    if (!partition) {
      throw new Error(`Partition not found: ${partitionName}`);
    }

    // Use cryptographically random temp path to prevent predictability
    const randomSuffix = crypto.randomBytes(8).toString('hex');
    const tempPath = `/sdcard/partition_dump_${randomSuffix}.img`;
    const startTime = Date.now();

    try {
      // Validate block device exists and is readable
      const checkResult = await CommandExecutor.shell(
        deviceId,
        `su -c "test -r '${partition.blockDevice.replace(/'/g, "'\\''")}' && echo 'ok'"`
      );
      if (!checkResult.success || !checkResult.stdout.includes('ok')) {
        throw new Error(`Block device not readable: ${partition.blockDevice}`);
      }

      // Dump partition using dd with root (properly quoted)
      const safeBlockDevice = partition.blockDevice.replace(/'/g, "'\\''");
      const safeTempPath = tempPath.replace(/'/g, "'\\''");
      const ddResult = await CommandExecutor.shell(
        deviceId,
        `su -c "dd if='${safeBlockDevice}' of='${safeTempPath}' bs=4096"`
      );

      if (!ddResult.success) {
        throw new Error(`Failed to dump partition: ${ddResult.stderr}`);
      }

      // Pull to PC
      const pullResult = await CommandExecutor.adb(deviceId, ['pull', tempPath, outputPath]);
      if (!pullResult.success) {
        throw new Error(`Failed to pull partition backup: ${pullResult.stderr}`);
      }

      let finalPath = outputPath;
      let compressedSize: number | undefined;
      let compressionRatio: string | undefined;

      // Compress if requested
      if (options.compress) {
        const compressedPath = outputPath + '.gz';
        await this.compressFile(outputPath, compressedPath);
        fs.unlinkSync(outputPath);
        finalPath = compressedPath;

        const stats = fs.statSync(compressedPath);
        compressedSize = stats.size;
        compressionRatio = ((1 - compressedSize / partition.sizeBytes) * 100).toFixed(1) + '%';
      }

      // Get file stats
      const stats = fs.statSync(finalPath);
      const sha256 = await this.calculateSHA256(finalPath);
      const durationMs = Date.now() - startTime;

      // Get device metadata if requested
      let metadata: EnhancedPartitionBackup['metadata'] | undefined;
      if (options.includeMetadata) {
        const [modelResult, versionResult, buildResult] = await Promise.all([
          CommandExecutor.shell(deviceId, 'getprop ro.product.model'),
          CommandExecutor.shell(deviceId, 'getprop ro.build.version.release'),
          CommandExecutor.shell(deviceId, 'getprop ro.build.id'),
        ]);

        metadata = {
          deviceModel: modelResult.success ? modelResult.stdout.trim() : 'Unknown',
          androidVersion: versionResult.success ? versionResult.stdout.trim() : 'Unknown',
          buildId: buildResult.success ? buildResult.stdout.trim() : 'Unknown',
        };
      }

      // Cleanup temp file
      await CommandExecutor.shell(deviceId, `rm '${tempPath}'`).catch(() => {});

      return {
        partition: partitionName,
        outputPath: finalPath,
        sizeBytes: stats.size,
        sizeHuman: formatBytes(stats.size),
        sha256,
        timestamp: new Date().toISOString(),
        duration: `${Math.round(durationMs / 1000)} seconds`,
        compressed: options.compress || false,
        compressedSize,
        compressionRatio,
        metadata,
      };
    } catch (error) {
      // Cleanup on error
      await CommandExecutor.shell(deviceId, `rm '${tempPath}'`).catch(() => {});
      throw error;
    }
  }

  /**
   * Compress file using gzip
   */
  private static compressFile(inputPath: string, outputPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const input = fs.createReadStream(inputPath);
      const output = fs.createWriteStream(outputPath);
      const gzip = zlib.createGzip({ level: 6 });

      input
        .pipe(gzip)
        .pipe(output)
        .on('finish', () => resolve())
        .on('error', reject);
    });
  }

  /**
   * Calculate SHA256 hash of file
   */
  static calculateSHA256(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);

      stream.on('data', (data) => hash.update(data));
      stream.on('end', () => resolve(hash.digest('hex')));
      stream.on('error', reject);
    });
  }

  /**
   * Parse manifest file for expected hashes (Google factory image format)
   */
  static parseManifest(manifestPath: string): Map<string, string> {
    const hashes = new Map<string, string>();

    if (!fs.existsSync(manifestPath)) {
      return hashes;
    }

    const content = fs.readFileSync(manifestPath, 'utf-8');
    const lines = content.split('\n');

    for (const line of lines) {
      // Format: SHA256_HASH  FILENAME
      // or: SHA256HASH FILENAME
      const match = line.match(/^([a-fA-F0-9]{64})\s+(.+)$/);
      if (match) {
        const hash = match[1].toLowerCase();
        const filename = match[2].trim();
        hashes.set(filename, hash);
      }
    }

    return hashes;
  }
}
