/**
 * Boot image patching tools
 * Handles boot.img manipulation for rooting
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as fsPromises from 'fs/promises';
import * as path from 'path';
import { ErrorHandler } from '../utils/error-handler.js';
import { formatBytes } from '../utils/formatter.js';
import { BootPatcher } from '../utils/boot-patcher.js';

// Schemas
export const GetBootImageInfoSchema = z.object({
  boot_image_path: z.string().describe('Path to boot.img file'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const UnpackBootImageSchema = z.object({
  boot_image_path: z.string().describe('Path to boot.img file'),
  output_dir: z.string().describe('Directory to extract components to'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const RepackBootImageSchema = z.object({
  work_dir: z.string().describe('Directory containing unpacked boot components'),
  output_path: z.string().describe('Path for the repacked boot.img'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const BackupStockBootSchema = z.object({
  boot_image_path: z.string().describe('Path to stock boot.img'),
  device_model: z.string().optional().describe('Device model name'),
  device_codename: z.string().optional().describe('Device codename'),
  android_version: z.string().optional().describe('Android version'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const PatchBootImageSchema = z.object({
  boot_image_path: z.string().describe('Path to stock boot.img'),
  magisk_apk_path: z.string().describe('Path to Magisk APK file'),
  output_path: z.string().describe('Path for patched boot.img output'),
  keep_verity: z.boolean().default(false).describe('Keep dm-verity (not recommended)'),
  keep_encryption: z.boolean().default(false).describe('Keep forced encryption'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

// Security: Path validation
function validatePath(filePath: string): void {
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

// Tool implementations
export const patchingTools = {
  get_boot_image_info: {
    description: `Analyze boot.img structure and properties.

Uses magiskboot to examine boot image internals:
- Header version and format
- Kernel and ramdisk sizes
- OS version and patch level
- Command line parameters
- Component detection (kernel, ramdisk, dtb, etc.)

This tool is read-only and safe to use.

Examples:
- get_boot_image_info(boot_image_path="/sdcard/boot.img")
- get_boot_image_info(boot_image_path="/extracted/boot.img", format="json")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        boot_image_path: {
          type: 'string' as const,
          description: 'Path to boot.img file'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['boot_image_path']
    },
    handler: async (args: z.infer<typeof GetBootImageInfoSchema>) => {
      return ErrorHandler.wrap(async () => {
        validatePath(args.boot_image_path);

        if (!fs.existsSync(args.boot_image_path)) {
          throw new Error(`Boot image not found: ${args.boot_image_path}`);
        }

        // Validate boot image magic bytes
        if (!(await BootPatcher.isValidBootImage(args.boot_image_path))) {
          throw new Error(`Not a valid Android boot image: ${args.boot_image_path}`);
        }

        const stats = await fsPromises.stat(args.boot_image_path);
        const info = await BootPatcher.getBootInfo(args.boot_image_path);

        if (args.format === 'json') {
          return JSON.stringify({
            path: args.boot_image_path,
            size: stats.size,
            sizeHuman: formatBytes(stats.size),
            ...info,
          }, null, 2);
        }

        let markdown = `# Boot Image Analysis\n\n`;
        markdown += `**Path**: ${args.boot_image_path}\n`;
        markdown += `**Size**: ${formatBytes(stats.size)}\n`;
        markdown += `**SHA1**: \`${info.sha1}\`\n\n`;

        markdown += `## Header Information\n\n`;
        markdown += `| Property | Value |\n`;
        markdown += `|----------|-------|\n`;
        markdown += `| Format | ${info.format} |\n`;
        markdown += `| Header Version | ${info.headerVersion} |\n`;
        markdown += `| Page Size | ${info.pageSize} bytes |\n`;
        markdown += `| OS Version | ${info.osVersion || 'N/A'} |\n`;
        markdown += `| Patch Level | ${info.osPatchLevel || 'N/A'} |\n\n`;

        markdown += `## Components\n\n`;
        markdown += `| Component | Size |\n`;
        markdown += `|-----------|------|\n`;
        markdown += `| Kernel | ${formatBytes(info.kernelSize)} |\n`;
        markdown += `| Ramdisk | ${info.hasRamdisk ? formatBytes(info.ramdiskSize) : 'N/A'} |\n`;
        if (info.hasDtb) {
          markdown += `| DTB | Present |\n`;
        }

        if (info.cmdline) {
          markdown += `\n## Command Line\n\n`;
          markdown += `\`\`\`\n${info.cmdline}\n\`\`\`\n`;
        }

        return markdown;
      });
    }
  },

  unpack_boot_image: {
    description: `Extract boot.img components to directory.

Uses magiskboot to unpack boot image into its components:
- kernel: The Linux kernel
- ramdisk.cpio: Init ramdisk (compressed)
- dtb: Device tree blob (if present)
- second: Second stage bootloader (rare)
- recovery_dtbo: Recovery DTBO (if present)

Components can be modified and repacked.

Examples:
- unpack_boot_image(boot_image_path="/boot.img", output_dir="/work/unpacked/")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        boot_image_path: {
          type: 'string' as const,
          description: 'Path to boot.img file'
        },
        output_dir: {
          type: 'string' as const,
          description: 'Directory to extract components to'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['boot_image_path', 'output_dir']
    },
    handler: async (args: z.infer<typeof UnpackBootImageSchema>) => {
      return ErrorHandler.wrap(async () => {
        validatePath(args.boot_image_path);
        validatePath(args.output_dir);

        if (!fs.existsSync(args.boot_image_path)) {
          throw new Error(`Boot image not found: ${args.boot_image_path}`);
        }

        const result = await BootPatcher.unpack(args.boot_image_path, args.output_dir);

        const componentList = Object.entries(result.components)
          .filter(([, v]) => v)
          .map(([k, v]) => ({
            name: k,
            path: v as string,
          }));

        if (args.format === 'json') {
          return JSON.stringify({
            success: result.success,
            outputDir: args.output_dir,
            components: componentList,
            headerInfo: result.headerInfo,
          }, null, 2);
        }

        let markdown = `# Boot Image Unpacked\n\n`;
        markdown += `**Source**: ${args.boot_image_path}\n`;
        markdown += `**Output**: ${args.output_dir}\n\n`;

        markdown += `## Extracted Components\n\n`;
        markdown += `| Component | Path |\n`;
        markdown += `|-----------|------|\n`;

        for (const comp of componentList) {
          markdown += `| ${comp.name} | ${path.basename(comp.path)} |\n`;
        }

        markdown += `\n**Status**: ✅ Unpacked successfully\n`;
        markdown += `\nUse \`repack_boot_image\` after making modifications.\n`;

        return markdown;
      });
    }
  },

  repack_boot_image: {
    description: `Repack boot.img from modified components.

Takes a directory with unpacked boot components and creates a new boot.img.

Requirements:
- Directory must contain original boot.img and extracted components
- Use after modifying kernel, ramdisk, or other components
- Creates new-boot.img which is copied to output_path

Examples:
- repack_boot_image(work_dir="/work/unpacked/", output_path="/work/modified-boot.img")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        work_dir: {
          type: 'string' as const,
          description: 'Directory containing unpacked boot components'
        },
        output_path: {
          type: 'string' as const,
          description: 'Path for the repacked boot.img'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['work_dir', 'output_path']
    },
    handler: async (args: z.infer<typeof RepackBootImageSchema>) => {
      return ErrorHandler.wrap(async () => {
        validatePath(args.work_dir);
        validatePath(args.output_path);

        if (!fs.existsSync(args.work_dir)) {
          throw new Error(`Work directory not found: ${args.work_dir}`);
        }

        const result = await BootPatcher.repack(args.work_dir, args.output_path);
        const stats = await fsPromises.stat(args.output_path);

        if (args.format === 'json') {
          return JSON.stringify({
            success: result.success,
            outputPath: result.outputPath,
            size: stats.size,
            sizeHuman: formatBytes(stats.size),
            sha1: result.sha1,
          }, null, 2);
        }

        let markdown = `# Boot Image Repacked\n\n`;
        markdown += `**Output**: ${result.outputPath}\n`;
        markdown += `**Size**: ${formatBytes(stats.size)}\n`;
        markdown += `**SHA1**: \`${result.sha1}\`\n\n`;
        markdown += `**Status**: ✅ Repacked successfully\n\n`;
        markdown += `⚠️ **Warning**: This image has not been flashed.\n`;
        markdown += `Use \`flash_partition\` to flash to device after verification.\n`;

        return markdown;
      });
    }
  },

  backup_stock_boot: {
    description: `Cache stock boot.img for recovery.

Saves a copy of the stock boot image with SHA1 fingerprint for later recovery.

Features:
- SHA1-based deduplication (same image = same cache entry)
- Metadata storage (device info, timestamp)
- Used automatically before patching

Cache location: ~/.android-debug-mcp/boot-cache/<sha1>/

Examples:
- backup_stock_boot(boot_image_path="/extracted/boot.img")
- backup_stock_boot(boot_image_path="/boot.img", device_model="Pixel 7", device_codename="panther")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        boot_image_path: {
          type: 'string' as const,
          description: 'Path to stock boot.img'
        },
        device_model: {
          type: 'string' as const,
          description: 'Device model name'
        },
        device_codename: {
          type: 'string' as const,
          description: 'Device codename'
        },
        android_version: {
          type: 'string' as const,
          description: 'Android version'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['boot_image_path']
    },
    handler: async (args: z.infer<typeof BackupStockBootSchema>) => {
      return ErrorHandler.wrap(async () => {
        validatePath(args.boot_image_path);

        if (!fs.existsSync(args.boot_image_path)) {
          throw new Error(`Boot image not found: ${args.boot_image_path}`);
        }

        const result = await BootPatcher.backupStock(args.boot_image_path, {
          model: args.device_model,
          codename: args.device_codename,
          androidVersion: args.android_version,
        });

        const stats = await fsPromises.stat(result.cachePath);

        if (args.format === 'json') {
          return JSON.stringify({
            cached: result.cached,
            isNew: result.isNew,
            sha1: result.sha1,
            cachePath: result.cachePath,
            size: stats.size,
            sizeHuman: formatBytes(stats.size),
          }, null, 2);
        }

        let markdown = `# Stock Boot Backup\n\n`;
        markdown += `**SHA1**: \`${result.sha1}\`\n`;
        markdown += `**Cache Path**: ${result.cachePath}\n`;
        markdown += `**Size**: ${formatBytes(stats.size)}\n\n`;

        if (result.isNew) {
          markdown += `**Status**: ✅ Newly cached\n`;
        } else {
          markdown += `**Status**: ℹ️ Already in cache (deduplicated)\n`;
        }

        if (args.device_model || args.device_codename) {
          markdown += `\n## Device Info\n\n`;
          if (args.device_model) markdown += `- Model: ${args.device_model}\n`;
          if (args.device_codename) markdown += `- Codename: ${args.device_codename}\n`;
          if (args.android_version) markdown += `- Android: ${args.android_version}\n`;
        }

        markdown += `\nThis backup can be used to restore stock boot if needed.\n`;

        return markdown;
      });
    }
  },

  patch_boot_image: {
    description: `Patch boot.img with Magisk for root access.

⚠️ IMPORTANT: This creates a PATCHED boot image but does NOT flash it.
You must manually verify and flash using flash_partition.

Process:
1. Backs up stock boot to cache (automatic)
2. Extracts Magisk components from APK
3. Patches ramdisk with Magisk init
4. Optionally removes verity/encryption
5. Repacks boot image

Requirements:
- Stock boot.img from your device/firmware
- Magisk APK file (download from official source)

Examples:
- patch_boot_image(
    boot_image_path="/extracted/boot.img",
    magisk_apk_path="/downloads/Magisk-v27.0.apk",
    output_path="/work/patched-boot.img"
  )`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        boot_image_path: {
          type: 'string' as const,
          description: 'Path to stock boot.img'
        },
        magisk_apk_path: {
          type: 'string' as const,
          description: 'Path to Magisk APK file'
        },
        output_path: {
          type: 'string' as const,
          description: 'Path for patched boot.img output'
        },
        keep_verity: {
          type: 'boolean' as const,
          default: false,
          description: 'Keep dm-verity (not recommended)'
        },
        keep_encryption: {
          type: 'boolean' as const,
          default: false,
          description: 'Keep forced encryption'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['boot_image_path', 'magisk_apk_path', 'output_path']
    },
    handler: async (args: z.infer<typeof PatchBootImageSchema>) => {
      return ErrorHandler.wrap(async () => {
        validatePath(args.boot_image_path);
        validatePath(args.magisk_apk_path);
        validatePath(args.output_path);

        if (!fs.existsSync(args.boot_image_path)) {
          throw new Error(`Boot image not found: ${args.boot_image_path}`);
        }
        if (!fs.existsSync(args.magisk_apk_path)) {
          throw new Error(`Magisk APK not found: ${args.magisk_apk_path}`);
        }

        const result = await BootPatcher.patchWithMagisk(
          args.boot_image_path,
          args.magisk_apk_path,
          args.output_path,
          {
            keepVerity: args.keep_verity,
            keepEncryption: args.keep_encryption,
          }
        );

        const stats = await fsPromises.stat(args.output_path);

        if (args.format === 'json') {
          return JSON.stringify({
            success: result.success,
            patchedPath: result.patchedPath,
            size: stats.size,
            sizeHuman: formatBytes(stats.size),
            sha1Original: result.sha1Original,
            sha1Patched: result.sha1Patched,
            backupPath: result.backupPath,
            patchMethod: result.patchMethod,
          }, null, 2);
        }

        let markdown = `# Boot Image Patched\n\n`;
        markdown += `**Status**: ✅ Patching successful\n\n`;

        markdown += `## Files\n\n`;
        markdown += `| Type | Path |\n`;
        markdown += `|------|------|\n`;
        markdown += `| Original | ${args.boot_image_path} |\n`;
        markdown += `| Patched | ${result.patchedPath} |\n`;
        if (result.backupPath) {
          markdown += `| Backup | ${result.backupPath} |\n`;
        }

        markdown += `\n## Checksums\n\n`;
        markdown += `| Image | SHA1 |\n`;
        markdown += `|-------|------|\n`;
        markdown += `| Original | \`${result.sha1Original}\` |\n`;
        markdown += `| Patched | \`${result.sha1Patched}\` |\n`;

        markdown += `\n## Patch Details\n\n`;
        markdown += `- Method: ${result.patchMethod}\n`;
        markdown += `- Keep Verity: ${args.keep_verity}\n`;
        markdown += `- Keep Encryption: ${args.keep_encryption}\n`;
        markdown += `- Size: ${formatBytes(stats.size)}\n`;

        markdown += `\n## ⚠️ Next Steps\n\n`;
        markdown += `The patched boot image has been created but **NOT flashed**.\n\n`;
        markdown += `To complete rooting:\n`;
        markdown += `1. Verify the patched image is correct\n`;
        markdown += `2. Reboot device to bootloader/fastboot\n`;
        markdown += `3. Flash using: \`flash_partition(device_id, "boot", "${result.patchedPath}")\`\n`;
        markdown += `4. Or: \`fastboot flash boot ${result.patchedPath}\`\n`;

        return markdown;
      });
    }
  }
};
