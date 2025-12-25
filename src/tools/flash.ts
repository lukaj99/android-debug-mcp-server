/**
 * Flashing & rooting tools (DESTRUCTIVE OPERATIONS)
 */

import { z } from 'zod';
import { DeviceManager } from '../utils/device-manager.js';
import { CommandExecutor } from '../utils/executor.js';
import { ResponseFormatter, formatBytes } from '../utils/formatter.js';
import { SafetyValidator } from '../utils/validator.js';
import { ErrorHandler } from '../utils/error-handler.js';
import { ImageValidator } from '../utils/image-validator.js';
import { PartitionManager } from '../utils/partition-manager.js';
import { AVBParser } from '../utils/avb-parser.js';
import type { PartitionInfo, PartitionBackup, DowngradeCheckResult } from '../types.js';
import * as crypto from 'crypto';
import * as fs from 'fs';

// Schemas
export const FlashPartitionSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  partition: z.string().describe('Partition name (boot, system, vendor, etc.)'),
  image_path: z.string().describe('Path to partition image file'),
  confirm_token: z.string().describe('Confirmation token (format: CONFIRM_FLASH_PARTITION_<timestamp>)')
}).strict();

export const BootImageSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  image_path: z.string().describe('Path to boot image file (boot.img, recovery.img)')
}).strict();

export const UnlockBootloaderSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  confirm_token: z.string().describe('Confirmation token (format: CONFIRM_UNLOCK_BOOTLOADER_<timestamp>)')
}).strict();

export const LockBootloaderSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  confirm_token: z.string().describe('Confirmation token (format: CONFIRM_LOCK_BOOTLOADER_<timestamp>)')
}).strict();

export const ErasePartitionSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  partition: z.string().describe('Partition name to erase'),
  confirm_token: z.string().describe('Confirmation token (format: CONFIRM_ERASE_PARTITION_<timestamp>)')
}).strict();

export const FormatPartitionSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  partition: z.string().describe('Partition name to format'),
  fs_type: z.string().optional().describe('Filesystem type (ext4, f2fs, etc.)'),
  confirm_token: z.string().describe('Confirmation token (format: CONFIRM_FORMAT_PARTITION_<timestamp>)')
}).strict();

export const SetActiveSlotSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  slot: z.enum(['a', 'b', 'all', 'other']).describe('Slot to activate (a, b, all, other)')
}).strict();

export const FlashAllSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  image_directory: z.string().describe('Directory containing factory image files'),
  wipe_data: z.boolean().default(true).describe('Wipe user data (factory reset)'),
  confirm_token: z.string().describe('Confirmation token (format: CONFIRM_FLASH_ALL_<timestamp>)')
}).strict();

export const ListPartitionsSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown'),
  detail: z.enum(['concise', 'detailed']).default('concise')
}).strict();

export const DumpPartitionSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  partition_name: z.string().describe('Partition name to backup (e.g., boot_a, system_a, vendor_a)'),
  output_path: z.string().describe('Local output path for partition backup (.img)'),
  confirm_token: z.string().describe('Confirmation token (format: CONFIRM_DUMP_PARTITION_<timestamp>)'),
  calculate_checksum: z.boolean().default(true).describe('Calculate SHA256 checksum of backup (default: true)')
}).strict();

// New Phase 1 Schemas
export const ValidateImageSchema = z.object({
  image_path: z.string().describe('Path to image file to validate'),
  expected_type: z.enum(['boot', 'vendor_boot', 'vbmeta', 'generic']).optional().describe('Expected image type'),
  expected_sha256: z.string().optional().describe('Expected SHA256 hash for verification'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const CheckDowngradeRiskSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  new_build_fingerprint: z.string().optional().describe('New firmware build fingerprint'),
  new_spl: z.string().optional().describe('New Security Patch Level (YYYY-MM-DD)'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

// Phase 2 Schemas
export const SwitchSlotSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  target_slot: z.enum(['a', 'b', 'other']).describe('Target slot to switch to'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const DumpPartitionFullSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  partition_name: z.string().describe('Partition name to backup (e.g., boot_a, system_a)'),
  output_path: z.string().describe('Local output path for partition backup'),
  confirm_token: z.string().describe('Confirmation token (format: CONFIRM_DUMP_PARTITION_FULL_<timestamp>)'),
  compress: z.boolean().default(false).describe('Compress backup with gzip'),
  include_metadata: z.boolean().default(true).describe('Include device metadata in backup')
}).strict();

export const ComparePartitionsSchema = z.object({
  file1_path: z.string().describe('Path to first partition image'),
  file2_path: z.string().describe('Path to second partition image'),
  detailed: z.boolean().default(false).describe('Show detailed diff regions'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const ListPartitionDetailsSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const VerifyPartitionIntegritySchema = z.object({
  image_path: z.string().describe('Path to partition image file'),
  expected_sha256: z.string().describe('Expected SHA256 hash'),
  partition_name: z.string().optional().describe('Partition name (for display)'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

// Tool implementations
export const flashTools = {
  flash_partition: {
    description: `Flash partition image to device.

⚠️ DESTRUCTIVE OPERATION - REQUIRES CONFIRMATION TOKEN ⚠️

Flashes a partition image (.img file) to the specified partition. Device must be in fastboot mode.

Common partitions:
- boot / boot_a / boot_b: Boot images (kernel)
- system / system_a / system_b: System partition
- vendor / vendor_a / vendor_b: Vendor partition
- recovery: Recovery partition
- vbmeta / vbmeta_a / vbmeta_b: Verified boot metadata

SAFETY REQUIREMENTS:
1. Device must be in fastboot/bootloader mode
2. Bootloader must be unlocked
3. Must provide valid confirmation token
4. Wrong partition can brick device - double check!

Generate token: CONFIRM_FLASH_PARTITION_<current_timestamp>

Examples:
- flash_partition(device_id="ABC123", partition="boot", image_path="/images/boot.img", confirm_token="CONFIRM_FLASH_PARTITION_1699999999000")
- flash_partition(device_id="ABC123", partition="vendor_a", image_path="/factory/vendor.img", confirm_token="CONFIRM_FLASH_PARTITION_1699999999000")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID in fastboot mode'
        },
        partition: {
          type: 'string' as const,
          description: 'Partition name (boot, system, vendor, etc.)'
        },
        image_path: {
          type: 'string' as const,
          description: 'Path to partition image file'
        },
        confirm_token: {
          type: 'string' as const,
          description: 'Confirmation token (format: CONFIRM_FLASH_PARTITION_<timestamp>)'
        }
      },
      required: ['device_id', 'partition', 'image_path', 'confirm_token']
    },
    handler: async (args: z.infer<typeof FlashPartitionSchema>) => {
      return ErrorHandler.wrap(async () => {
        SafetyValidator.validateConfirmationToken('FLASH_PARTITION', args.confirm_token);

        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot mode. Current: ${device.mode}. ` +
            `Use reboot_device(device_id="${args.device_id}", mode="bootloader") first.`
          );
        }

        SafetyValidator.validatePartitionName(args.partition);
        SafetyValidator.validateDevicePath(args.image_path);

        const result = await CommandExecutor.fastboot(args.device_id, [
          'flash',
          args.partition,
          args.image_path
        ]);

        if (!result.success) {
          throw new Error(`Flash failed: ${result.stderr}`);
        }

        DeviceManager.clearCache();

        return ResponseFormatter.success(
          `Partition flashed successfully: ${args.partition}`,
          {
            partition: args.partition,
            image: args.image_path,
            warning: 'Device may need reboot to use new partition'
          }
        );
      });
    }
  },

  boot_image: {
    description: `Temporarily boot image without flashing.

Boots a boot image (kernel + ramdisk) temporarily without permanently flashing it. Device will revert to original boot image on next reboot. Useful for testing custom kernels, recovery images, or rooted boot images without permanent changes.

Device must be in fastboot mode. No confirmation token required (non-destructive).

Examples:
- boot_image(device_id="ABC123", image_path="/images/twrp-recovery.img") → Boot TWRP temporarily
- boot_image(device_id="ABC123", image_path="/magisk/magisk_patched.img") → Boot Magisk-patched boot`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID in fastboot mode'
        },
        image_path: {
          type: 'string' as const,
          description: 'Path to boot image file (boot.img, recovery.img)'
        }
      },
      required: ['device_id', 'image_path']
    },
    handler: async (args: z.infer<typeof BootImageSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot mode. Current: ${device.mode}. ` +
            `Use reboot_device(device_id="${args.device_id}", mode="bootloader") first.`
          );
        }

        SafetyValidator.validateDevicePath(args.image_path);

        const result = await CommandExecutor.fastboot(args.device_id, [
          'boot',
          args.image_path
        ]);

        if (!result.success) {
          throw new Error(`Boot failed: ${result.stderr}`);
        }

        DeviceManager.clearCache();

        return ResponseFormatter.success(
          `Device booting with temporary image`,
          {
            image: args.image_path,
            note: 'This is temporary. Device will revert to original boot image on next reboot.'
          }
        );
      });
    }
  },

  unlock_bootloader: {
    description: `Unlock device bootloader.

⚠️ EXTREMELY DESTRUCTIVE - WIPES ALL DATA - REQUIRES CONFIRMATION TOKEN ⚠️

Unlocking the bootloader:
- ERASES ALL USER DATA (factory reset)
- ERASES ALL APPS
- ERASES ALL PHOTOS, VIDEOS, DOCUMENTS
- VOIDS WARRANTY on some devices
- May trip KNOX/SafetyNet on Samsung/Google devices
- CANNOT BE UNDONE easily

REQUIRED:
- Device in fastboot mode
- OEM unlocking enabled (Settings > Developer Options > OEM unlocking)
- Valid confirmation token

This enables:
- Flashing custom ROMs
- Installing custom recovery (TWRP)
- Gaining root access (Magisk)
- Flashing custom kernels

Generate token: CONFIRM_UNLOCK_BOOTLOADER_<current_timestamp>

Example:
- unlock_bootloader(device_id="ABC123", confirm_token="CONFIRM_UNLOCK_BOOTLOADER_1699999999000")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID in fastboot mode'
        },
        confirm_token: {
          type: 'string' as const,
          description: 'Confirmation token (format: CONFIRM_UNLOCK_BOOTLOADER_<timestamp>)'
        }
      },
      required: ['device_id', 'confirm_token']
    },
    handler: async (args: z.infer<typeof UnlockBootloaderSchema>) => {
      return ErrorHandler.wrap(async () => {
        SafetyValidator.validateConfirmationToken('UNLOCK_BOOTLOADER', args.confirm_token);

        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot mode. Current: ${device.mode}. ` +
            `Use reboot_device(device_id="${args.device_id}", mode="bootloader") first.`
          );
        }

        // Check if already unlocked
        const checkResult = await CommandExecutor.fastboot(args.device_id, [
          'getvar',
          'unlocked'
        ]);

        if (checkResult.stderr.includes('yes')) {
          return ResponseFormatter.warning(
            'Bootloader is already unlocked. No action needed.'
          );
        }

        // Try modern unlock command first
        let result = await CommandExecutor.fastboot(args.device_id, [
          'flashing',
          'unlock'
        ]);

        // If that fails, try legacy command
        if (!result.success) {
          result = await CommandExecutor.fastboot(args.device_id, [
            'oem',
            'unlock'
          ]);
        }

        if (!result.success) {
          throw new Error(
            `Unlock failed: ${result.stderr}\n\n` +
            `Check:\n` +
            `1. OEM unlocking enabled in Developer Options\n` +
            `2. Device manufacturer allows bootloader unlock\n` +
            `3. Follow on-device prompts (volume/power buttons)`
          );
        }

        DeviceManager.clearCache();

        return ResponseFormatter.success(
          'Bootloader unlock initiated',
          {
            warning: 'ALL DATA HAS BEEN WIPED',
            note: 'Follow on-device prompts to complete unlock. Device will reboot.',
            next_steps: [
              'Device will perform factory reset',
              'Setup wizard will run on reboot',
              'Re-enable USB debugging and Developer Options'
            ]
          }
        );
      });
    }
  },

  lock_bootloader: {
    description: `Lock device bootloader.

⚠️ DESTRUCTIVE OPERATION - WIPES ALL DATA - REQUIRES CONFIRMATION TOKEN ⚠️

Locking the bootloader:
- ERASES ALL USER DATA (factory reset)
- ERASES ALL APPS
- ERASES ALL PHOTOS, VIDEOS, DOCUMENTS
- Restores device security
- Re-enables SafetyNet/KNOX (may still be tripped)
- May restore warranty

WARNING: Locking bootloader with custom ROM/recovery can BRICK device!
ONLY lock if device has stock firmware installed.

Generate token: CONFIRM_LOCK_BOOTLOADER_<current_timestamp>

Example:
- lock_bootloader(device_id="ABC123", confirm_token="CONFIRM_LOCK_BOOTLOADER_1699999999000")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID in fastboot mode'
        },
        confirm_token: {
          type: 'string' as const,
          description: 'Confirmation token (format: CONFIRM_LOCK_BOOTLOADER_<timestamp>)'
        }
      },
      required: ['device_id', 'confirm_token']
    },
    handler: async (args: z.infer<typeof LockBootloaderSchema>) => {
      return ErrorHandler.wrap(async () => {
        SafetyValidator.validateConfirmationToken('LOCK_BOOTLOADER', args.confirm_token);

        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot mode. Current: ${device.mode}. ` +
            `Use reboot_device(device_id="${args.device_id}", mode="bootloader") first.`
          );
        }

        // Try modern lock command first
        let result = await CommandExecutor.fastboot(args.device_id, [
          'flashing',
          'lock'
        ]);

        // If that fails, try legacy command
        if (!result.success) {
          result = await CommandExecutor.fastboot(args.device_id, [
            'oem',
            'lock'
          ]);
        }

        if (!result.success) {
          throw new Error(`Lock failed: ${result.stderr}`);
        }

        DeviceManager.clearCache();

        return ResponseFormatter.success(
          'Bootloader lock initiated',
          {
            warning: 'ALL DATA HAS BEEN WIPED',
            note: 'Follow on-device prompts to complete lock. Device will reboot.',
            critical: 'If device has custom ROM/recovery, it may be BRICKED!'
          }
        );
      });
    }
  },

  erase_partition: {
    description: `Erase partition on device.

⚠️ DESTRUCTIVE OPERATION - REQUIRES CONFIRMATION TOKEN ⚠️

Completely erases the specified partition. Data is unrecoverable.

WARNING: Erasing critical partitions can brick device!

Safe to erase:
- cache: Cache partition (safe)
- userdata: User data (same as factory reset)

Dangerous to erase:
- boot: Will not boot
- system: Will not boot
- recovery: Cannot enter recovery

Generate token: CONFIRM_ERASE_PARTITION_<current_timestamp>

Example:
- erase_partition(device_id="ABC123", partition="cache", confirm_token="CONFIRM_ERASE_PARTITION_1699999999000")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID in fastboot mode'
        },
        partition: {
          type: 'string' as const,
          description: 'Partition name to erase'
        },
        confirm_token: {
          type: 'string' as const,
          description: 'Confirmation token (format: CONFIRM_ERASE_PARTITION_<timestamp>)'
        }
      },
      required: ['device_id', 'partition', 'confirm_token']
    },
    handler: async (args: z.infer<typeof ErasePartitionSchema>) => {
      return ErrorHandler.wrap(async () => {
        SafetyValidator.validateConfirmationToken('ERASE_PARTITION', args.confirm_token);

        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot mode. Current: ${device.mode}`
          );
        }

        SafetyValidator.validatePartitionName(args.partition);

        const result = await CommandExecutor.fastboot(args.device_id, [
          'erase',
          args.partition
        ]);

        if (!result.success) {
          throw new Error(`Erase failed: ${result.stderr}`);
        }

        DeviceManager.clearCache();

        return ResponseFormatter.success(
          `Partition erased: ${args.partition}`,
          {
            partition: args.partition,
            warning: 'Data is permanently deleted and unrecoverable'
          }
        );
      });
    }
  },

  format_partition: {
    description: `Format partition with filesystem.

⚠️ DESTRUCTIVE OPERATION - REQUIRES CONFIRMATION TOKEN ⚠️

Formats partition with specified filesystem. Different from erase (creates filesystem structure).

Common filesystems:
- ext4: Default Linux filesystem
- f2fs: Flash-friendly filesystem (faster on flash storage)

Typically used for userdata partition. Be very careful with other partitions.

Generate token: CONFIRM_FORMAT_PARTITION_<current_timestamp>

Example:
- format_partition(device_id="ABC123", partition="userdata", fs_type="ext4", confirm_token="CONFIRM_FORMAT_PARTITION_1699999999000")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID in fastboot mode'
        },
        partition: {
          type: 'string' as const,
          description: 'Partition name to format'
        },
        fs_type: {
          type: 'string' as const,
          description: 'Filesystem type (ext4, f2fs, etc.)'
        },
        confirm_token: {
          type: 'string' as const,
          description: 'Confirmation token (format: CONFIRM_FORMAT_PARTITION_<timestamp>)'
        }
      },
      required: ['device_id', 'partition', 'confirm_token']
    },
    handler: async (args: z.infer<typeof FormatPartitionSchema>) => {
      return ErrorHandler.wrap(async () => {
        SafetyValidator.validateConfirmationToken('FORMAT_PARTITION', args.confirm_token);

        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot mode. Current: ${device.mode}`
          );
        }

        SafetyValidator.validatePartitionName(args.partition);

        const formatStr = args.fs_type
          ? `${args.fs_type}:${args.partition}`
          : args.partition;

        const result = await CommandExecutor.fastboot(args.device_id, [
          'format',
          formatStr
        ]);

        if (!result.success) {
          throw new Error(`Format failed: ${result.stderr}`);
        }

        DeviceManager.clearCache();

        return ResponseFormatter.success(
          `Partition formatted: ${args.partition}`,
          {
            partition: args.partition,
            filesystem: args.fs_type || 'default',
            warning: 'All data on partition has been erased'
          }
        );
      });
    }
  },

  set_active_slot: {
    description: `Set active A/B partition slot.

For devices with A/B partitions, switch between slots. No data loss.

Slots:
- a: Set slot A as active
- b: Set slot B as active
- all: Mark both slots as active (unusual)
- other: Switch to the non-current slot

A/B partitions allow seamless updates. System updates to inactive slot, then switches.

No confirmation token required (non-destructive).

Examples:
- set_active_slot(device_id="ABC123", slot="b") → Switch to slot B
- set_active_slot(device_id="ABC123", slot="other") → Switch to other slot`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID in fastboot mode'
        },
        slot: {
          type: 'string' as const,
          enum: ['a', 'b', 'all', 'other'],
          description: 'Slot to activate (a, b, all, other)'
        }
      },
      required: ['device_id', 'slot']
    },
    handler: async (args: z.infer<typeof SetActiveSlotSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot mode. Current: ${device.mode}`
          );
        }

        const result = await CommandExecutor.fastboot(args.device_id, [
          'set_active',
          args.slot
        ]);

        if (!result.success) {
          throw new Error(`Failed to set active slot: ${result.stderr}`);
        }

        DeviceManager.clearCache();

        return ResponseFormatter.success(
          `Active slot set to: ${args.slot}`,
          {
            slot: args.slot,
            note: 'Device will boot from this slot on next reboot'
          }
        );
      });
    }
  },

  flash_all: {
    description: `Flash complete factory image.

⚠️ EXTREMELY DESTRUCTIVE - REQUIRES CONFIRMATION TOKEN ⚠️

Flashes all partitions from factory image directory. This is a complete device restoration.

What gets flashed:
- Bootloader
- Radio/modem
- Boot image
- System partition
- Vendor partition
- All other partitions

Options:
- wipe_data: true (default) = Factory reset, wipe all user data
- wipe_data: false = Keep user data (may cause boot issues)

Device will be completely restored to factory state if wipe_data=true.

REQUIREMENTS:
- Device in fastboot mode
- Bootloader unlocked
- Factory image directory with all .img files
- flash-all script or equivalent images

Generate token: CONFIRM_FLASH_ALL_<current_timestamp>

Example:
- flash_all(device_id="ABC123", image_directory="/factory-images/pixel-7-tq1a/", wipe_data=true, confirm_token="CONFIRM_FLASH_ALL_1699999999000")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID in fastboot mode'
        },
        image_directory: {
          type: 'string' as const,
          description: 'Directory containing factory image files'
        },
        wipe_data: {
          type: 'boolean' as const,
          default: true,
          description: 'Wipe user data (factory reset)'
        },
        confirm_token: {
          type: 'string' as const,
          description: 'Confirmation token (format: CONFIRM_FLASH_ALL_<timestamp>)'
        }
      },
      required: ['device_id', 'image_directory', 'confirm_token']
    },
    handler: async (args: z.infer<typeof FlashAllSchema>) => {
      return ErrorHandler.wrap(async () => {
        SafetyValidator.validateConfirmationToken('FLASH_ALL', args.confirm_token);

        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot mode. Current: ${device.mode}`
          );
        }

        SafetyValidator.validateDevicePath(args.image_directory);

        const cmdArgs = ['flashall'];
        if (!args.wipe_data) cmdArgs.push('--skip-wipe');

        const result = await CommandExecutor.fastboot(args.device_id, cmdArgs);

        if (!result.success) {
          throw new Error(`Flash all failed: ${result.stderr}`);
        }

        DeviceManager.clearCache();

        return ResponseFormatter.success(
          'Factory image flashed successfully',
          {
            directory: args.image_directory,
            data_wiped: args.wipe_data,
            warning: args.wipe_data ? 'ALL USER DATA HAS BEEN WIPED' : 'User data preserved (may cause boot issues)',
            note: 'Device will reboot automatically. First boot may take 5-10 minutes.'
          }
        );
      });
    }
  },

  list_partitions: {
    description: `List all device partitions with details.

Returns comprehensive partition information:
- Partition name (boot, system, vendor, etc.)
- Block device path
- Size in bytes and human-readable format
- Critical partition marking (system-critical partitions)

Critical partitions are marked to warn before dangerous operations. These include:
- boot, system, vendor (core OS)
- userdata, metadata (user data)
- vbmeta (verified boot)
- bootloader, radio/modem

Useful for:
- Identifying which partitions to backup
- Understanding device storage layout
- Planning partition operations
- Verifying A/B slot configurations

Requires: Android device in ADB mode

Examples:
- list_partitions(device_id="ABC123") → List all partitions
- list_partitions(device_id="ABC123", detail="detailed") → Show full details
- list_partitions(device_id="ABC123", format="json") → Structured data`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        },
        detail: {
          type: 'string' as const,
          enum: ['concise', 'detailed'],
          default: 'concise'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof ListPartitionsSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'device') {
          throw new Error(
            `Device must be in ADB mode. Current mode: ${device.mode}\n\n` +
            `Use reboot_device(device_id="${args.device_id}", mode="system") to reboot to ADB mode.`
          );
        }

        // Get partition list from /dev/block/by-name/
        const byNameResult = await CommandExecutor.shell(
          args.device_id,
          'ls -la /dev/block/by-name/'
        );

        if (!byNameResult.success) {
          throw new Error(
            `Failed to list partitions: ${byNameResult.stderr}\n\n` +
            `Device may not support /dev/block/by-name/ structure.`
          );
        }

        // Parse partition symbolic links
        // Format: "lrwxrwxrwx 1 root root 21 2024-01-01 00:00 boot_a -> /dev/block/sda12"
        const lines = byNameResult.stdout.split('\n');
        const partitions: PartitionInfo[] = [];

        for (const line of lines) {
          const match = line.match(/([a-zA-Z0-9_-]+)\s*->\s*(\/dev\/block\/[a-zA-Z0-9_-]+)/);
          if (match) {
            const partitionName = match[1];
            const blockDevice = match[2];

            // Get partition size
            let sizeBytes = 0;
            const sizeResult = await CommandExecutor.shell(
              args.device_id,
              `blockdev --getsize64 ${blockDevice} 2>/dev/null || echo 0`
            );

            if (sizeResult.success) {
              sizeBytes = parseInt(sizeResult.stdout.trim(), 10) || 0;
            }

            // Determine if partition is critical
            const critical = SafetyValidator.isCriticalPartition(partitionName);

            partitions.push({
              name: partitionName,
              device: partitionName,
              blockDevice,
              sizeBytes,
              sizeHuman: formatBytes(sizeBytes),
              critical
            });
          }
        }

        if (partitions.length === 0) {
          return ResponseFormatter.warning(
            'No partitions found. Device may not support partition listing via /dev/block/by-name/.'
          );
        }

        // Sort: critical first, then by name
        partitions.sort((a, b) => {
          if (a.critical !== b.critical) {
            return a.critical ? -1 : 1;
          }
          return a.name.localeCompare(b.name);
        });

        if (args.format === 'json') {
          return JSON.stringify(partitions, null, 2);
        }

        let result = `# Device Partitions\n\n`;
        result += `**Device**: ${args.device_id}\n`;
        result += `**Total Partitions**: ${partitions.length}\n\n`;

        if (args.detail === 'detailed') {
          result += `| Name | Size | Block Device | Critical |\n`;
          result += `|------|------|--------------|----------|\n`;

          for (const partition of partitions) {
            const criticalMark = partition.critical ? '⚠️ YES' : 'No';
            result += `| ${partition.name} | ${partition.sizeHuman} | ${partition.blockDevice} | ${criticalMark} |\n`;
          }
        } else {
          // Concise: group by critical status
          const critical = partitions.filter(p => p.critical);
          const nonCritical = partitions.filter(p => !p.critical);

          if (critical.length > 0) {
            result += `**Critical Partitions** (⚠️ ${critical.length}):\n`;
            for (const p of critical) {
              result += `- **${p.name}**: ${p.sizeHuman}\n`;
            }
            result += `\n`;
          }

          if (nonCritical.length > 0) {
            result += `**Other Partitions** (${nonCritical.length}):\n`;
            for (const p of nonCritical) {
              result += `- ${p.name}: ${p.sizeHuman}\n`;
            }
          }
        }

        result += `\n💡 **Tip**: Critical partitions require extra caution when dumping or flashing.`;

        return result;
      });
    }
  },

  dump_partition: {
    description: `Backup partition to local file.

⚠️ REQUIRES ROOT ACCESS & CONFIRMATION TOKEN ⚠️

Creates a complete backup of the specified partition to your PC. This is essential before:
- Flashing modified boot images
- Installing custom ROMs
- Experimenting with system modifications
- OTA updates that might fail

Features:
- Complete partition backup
- Optional SHA256 checksum verification
- Progress indication for large partitions
- Automatic cleanup of temp files
- Critical partition warnings

Safety:
- Requires root access (su)
- Requires confirmation token (DESTRUCTIVE category)
- Validates partition exists
- Checks available storage
- Warns for critical partitions

Process:
1. Validates root access
2. Checks partition exists
3. Copies partition to device storage (dd)
4. Pulls to PC via ADB
5. Calculates checksum (optional)
6. Cleans up temp files

⚠️ **Warning**: Large partitions (system ~2GB+) take significant time!

Requires: 
- Rooted device in ADB mode
- Sufficient storage on device and PC
- Root permissions granted to shell

Examples:
- dump_partition(device_id="ABC123", partition_name="boot_a", output_path="/backups/boot_a.img", confirm_token="CONFIRM_DUMP_PARTITION_1705334400000")
- dump_partition(device_id="ABC123", partition_name="vendor_b", output_path="/backups/vendor_b.img", confirm_token="CONFIRM_DUMP_PARTITION_1705334400000", calculate_checksum=false)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        partition_name: {
          type: 'string' as const,
          description: 'Partition name to backup (e.g., boot_a, system_a, vendor_a)'
        },
        output_path: {
          type: 'string' as const,
          description: 'Local output path for partition backup (.img)'
        },
        confirm_token: {
          type: 'string' as const,
          description: 'Confirmation token (format: CONFIRM_DUMP_PARTITION_<timestamp>)'
        },
        calculate_checksum: {
          type: 'boolean' as const,
          default: true,
          description: 'Calculate SHA256 checksum of backup (default: true)'
        }
      },
      required: ['device_id', 'partition_name', 'output_path', 'confirm_token']
    },
    handler: async (args: z.infer<typeof DumpPartitionSchema>) => {
      return ErrorHandler.wrap(async () => {
        // Validate confirmation token
        SafetyValidator.validateConfirmationToken('DUMP_PARTITION', args.confirm_token);

        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'device') {
          throw new Error(
            `Device must be in ADB mode. Current mode: ${device.mode}`
          );
        }

        // Check root access
        const rootCheck = await CommandExecutor.shell(args.device_id, 'su -c id');
        if (!rootCheck.success || !rootCheck.stdout.includes('uid=0')) {
          throw new Error(
            `Root access required for partition backup.\n\n` +
            `Possible solutions:\n` +
            `- Device must be rooted (Magisk, KernelSU, etc.)\n` +
            `- Grant root permissions to shell in root app\n` +
            `- Try 'adb root' if device is rooted via engineering build`
          );
        }

        // List partitions to validate
        const listResult = await CommandExecutor.shell(
          args.device_id,
          'ls -la /dev/block/by-name/'
        );

        if (!listResult.success) {
          throw new Error('Failed to list partitions. Device may not be supported.');
        }

        // Parse available partitions
        const lines = listResult.stdout.split('\n');
        const availablePartitions: PartitionInfo[] = [];

        for (const line of lines) {
          const match = line.match(/([a-zA-Z0-9_-]+)\s*->\s*(\/dev\/block\/[a-zA-Z0-9_-]+)/);
          if (match) {
            const name = match[1];
            const blockDevice = match[2];
            const critical = SafetyValidator.isCriticalPartition(name);

            availablePartitions.push({
              name,
              device: name,
              blockDevice,
              sizeBytes: 0,
              sizeHuman: '0',
              critical
            });
          }
        }

        // Validate partition exists
        const partition = SafetyValidator.validatePartitionExists(
          args.partition_name,
          availablePartitions
        );

        // Warn if critical partition
        if (partition.critical) {
          console.error(
            `⚠️  WARNING: "${args.partition_name}" is a critical system partition. ` +
            `Ensure you understand the implications of dumping system partitions.`
          );
        }

        // Get partition size
        const sizeResult = await CommandExecutor.shell(
          args.device_id,
          `su -c "blockdev --getsize64 ${partition.blockDevice}"`
        );

        const sizeBytes = parseInt(sizeResult.stdout.trim(), 10) || 0;
        const sizeHuman = formatBytes(sizeBytes);

        // Check available space on device
        const spaceResult = await CommandExecutor.shell(
          args.device_id,
          'df /sdcard | tail -1'
        );

        if (spaceResult.success) {
          const spaceMatch = spaceResult.stdout.match(/\s+(\d+)\s+\d+\s+(\d+)/);
          if (spaceMatch) {
            const availableKB = parseInt(spaceMatch[2], 10);
            const availableBytes = availableKB * 1024;

            if (availableBytes < sizeBytes) {
              throw new Error(
                `Insufficient storage on device.\n\n` +
                `Partition size: ${sizeHuman}\n` +
                `Available space: ${formatBytes(availableBytes)}\n\n` +
                `Free up space on device before dumping partition.`
              );
            }
          }
        }

        const tempPath = `/sdcard/partition_backup_${Date.now()}.img`;
        const startTime = Date.now();

        try {
          console.error(`Starting partition dump: ${args.partition_name} (${sizeHuman})...`);

          // Dump partition using dd with root
          const ddResult = await CommandExecutor.shell(
            args.device_id,
            `su -c "dd if=${partition.blockDevice} of=${tempPath} bs=4096"`
          );

          if (!ddResult.success) {
            throw new Error(
              `Failed to dump partition: ${ddResult.stderr}\n\n` +
              `This could indicate:\n` +
              `- Insufficient permissions\n` +
              `- Partition is locked or in use\n` +
              `- Storage issues`
            );
          }

          console.error('Partition dumped to device, pulling to PC...');

          // Pull to PC
          const pullResult = await CommandExecutor.adb(args.device_id, [
            'pull',
            tempPath,
            args.output_path
          ]);

          if (!pullResult.success) {
            throw new Error(`Failed to pull partition backup: ${pullResult.stderr}`);
          }

          // Get actual file size
          const stats = fs.statSync(args.output_path);
          const actualSize = stats.size;
          const durationMs = Date.now() - startTime;
          const durationSeconds = Math.round(durationMs / 1000);

          // Calculate SHA256 if requested
          let sha256: string | undefined;
          if (args.calculate_checksum) {
            console.error('Calculating SHA256 checksum...');
            const fileBuffer = fs.readFileSync(args.output_path);
            const hashSum = crypto.createHash('sha256');
            hashSum.update(fileBuffer);
            sha256 = hashSum.digest('hex');
          }

          // Cleanup temp file
          await CommandExecutor.shell(args.device_id, `rm ${tempPath}`).catch(() => {
            console.error('Warning: Failed to cleanup temp file on device');
          });

          const backup: PartitionBackup = {
            partition: args.partition_name,
            outputPath: args.output_path,
            sizeBytes: actualSize,
            sizeHuman: formatBytes(actualSize),
            sha256,
            timestamp: new Date().toISOString(),
            duration: `${durationSeconds} seconds`
          };

          let result = `# Partition Backup Complete\n\n`;
          result += `**Partition**: ${backup.partition}${partition.critical ? ' ⚠️ (critical)' : ''}\n`;
          result += `**Output Path**: ${backup.outputPath}\n`;
          result += `**Size**: ${backup.sizeHuman} (${backup.sizeBytes.toLocaleString()} bytes)\n`;
          result += `**Duration**: ${backup.duration}\n`;
          result += `**Timestamp**: ${backup.timestamp}\n`;

          if (backup.sha256) {
            result += `**SHA256**: ${backup.sha256}\n`;
          }

          result += `\n✅ **Success**: Partition backed up successfully!\n`;
          result += `\n💡 **Tip**: Store this backup safely. You can restore it using flash_partition if needed.`;

          return result;

        } catch (error) {
          // Cleanup on error
          await CommandExecutor.shell(args.device_id, `rm ${tempPath}`).catch(() => {});
          throw error;
        }
      });
    }
  },

  validate_image: {
    description: `Validate image file before flashing.

Pre-flight validation for image files to prevent flashing corrupted or wrong images.

Checks performed:
- File exists and is readable
- File size is reasonable
- Magic bytes match expected image type
- Boot image header parsing (for boot.img)
- SHA256 checksum calculation
- Optional checksum verification

Detected image types:
- boot: Android boot images (ANDROID! magic)
- vendor_boot: Vendor boot images (VNDRBOOT magic)
- vbmeta: AVB metadata images (AVB0 magic)
- sparse: Sparse images (Android sparse format)

For boot images, additionally reports:
- Header version
- Kernel/ramdisk sizes
- Page size
- OS version and patch level

This is a READ-ONLY operation. No confirmation token required.

Examples:
- validate_image(image_path="/downloads/boot.img") → Validate boot image
- validate_image(image_path="/factory/system.img", expected_type="generic") → Validate any image
- validate_image(image_path="/magisk/patched.img", expected_sha256="abc123...") → Verify checksum`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        image_path: {
          type: 'string' as const,
          description: 'Path to image file to validate'
        },
        expected_type: {
          type: 'string' as const,
          enum: ['boot', 'vendor_boot', 'vbmeta', 'generic'],
          description: 'Expected image type (optional)'
        },
        expected_sha256: {
          type: 'string' as const,
          description: 'Expected SHA256 hash for verification (optional)'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['image_path']
    },
    handler: async (args: z.infer<typeof ValidateImageSchema>) => {
      return ErrorHandler.wrap(async () => {
        const validation = await ImageValidator.validateImage(
          args.image_path,
          args.expected_type as 'boot' | 'vendor_boot' | 'vbmeta' | 'generic' | undefined
        );

        // Verify checksum if provided
        let checksumMatch: boolean | undefined;
        if (args.expected_sha256 && validation.sha256) {
          const verifyResult = await ImageValidator.verifyChecksum(
            args.image_path,
            args.expected_sha256
          );
          checksumMatch = verifyResult.valid;
          if (!checksumMatch) {
            validation.errors.push(
              `SHA256 mismatch!\n  Expected: ${args.expected_sha256}\n  Actual: ${validation.sha256}`
            );
            validation.valid = false;
          }
        }

        if (args.format === 'json') {
          return JSON.stringify({
            ...validation,
            checksumVerified: checksumMatch,
          }, null, 2);
        }

        let result = `# Image Validation: ${args.image_path}\n\n`;

        // Overall status
        const statusIcon = validation.valid ? '✅' : '❌';
        result += `**Status**: ${statusIcon} ${validation.valid ? 'VALID' : 'INVALID'}\n\n`;

        // Basic info
        result += `## File Information\n\n`;
        result += `| Property | Value |\n`;
        result += `|----------|-------|\n`;
        result += `| Exists | ${validation.exists ? 'Yes' : 'No'} |\n`;
        result += `| Size | ${validation.sizeHuman} |\n`;
        result += `| Type | ${validation.type} |\n`;
        result += `| SHA256 | \`${validation.sha256.substring(0, 16)}...${validation.sha256.substring(56)}\` |\n`;

        // Checksum verification
        if (checksumMatch !== undefined) {
          result += `| Checksum Match | ${checksumMatch ? '✅ Yes' : '❌ No'} |\n`;
        }

        // Boot image details
        if (validation.bootImageInfo) {
          const info = validation.bootImageInfo;
          result += `\n## Boot Image Details\n\n`;
          result += `| Property | Value |\n`;
          result += `|----------|-------|\n`;
          result += `| Header Version | ${info.headerVersion} |\n`;
          result += `| Page Size | ${info.pageSize} |\n`;
          result += `| Kernel Size | ${formatBytes(info.kernelSize)} |\n`;
          result += `| Ramdisk Size | ${formatBytes(info.ramdiskSize)} |\n`;
          if (info.osVersion) {
            result += `| OS Version | ${info.osVersion} |\n`;
          }
          if (info.osPatchLevel) {
            result += `| Patch Level | ${info.osPatchLevel} |\n`;
          }
        }

        // Warnings
        if (validation.warnings.length > 0) {
          result += `\n## ⚠️ Warnings\n\n`;
          for (const warning of validation.warnings) {
            result += `- ${warning}\n`;
          }
        }

        // Errors
        if (validation.errors.length > 0) {
          result += `\n## ❌ Errors\n\n`;
          for (const error of validation.errors) {
            result += `- ${error}\n`;
          }
        }

        // Recommendation
        result += `\n## Recommendation\n\n`;
        if (validation.valid) {
          result += `✅ Image appears valid and safe to flash.\n`;
        } else {
          result += `❌ Image validation failed. Do NOT flash this image.\n`;
          result += `\nResolve the errors above before proceeding.`;
        }

        return result;
      });
    }
  },

  check_downgrade_risk: {
    description: `Check for firmware downgrade risk.

Compares current device firmware with new firmware to detect potential downgrade scenarios.

⚠️ IMPORTANT: Downgrading firmware can trigger anti-rollback protection and BRICK the device!

Checks performed:
- Build date comparison (YYMMDD from fingerprint)
- Security Patch Level (SPL) comparison
- Build ID changes

Risk levels:
- none: Safe to proceed
- low: Minor version difference, likely safe
- medium: Significant difference, proceed with caution
- high: Downgrade detected, DO NOT PROCEED

This tool helps prevent accidentally flashing older firmware that would trip anti-rollback.

Examples:
- check_downgrade_risk(device_id="ABC123", new_spl="2024-01-01") → Check SPL
- check_downgrade_risk(device_id="ABC123", new_build_fingerprint="google/oriole/...") → Full check`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        new_build_fingerprint: {
          type: 'string' as const,
          description: 'New firmware build fingerprint (optional)'
        },
        new_spl: {
          type: 'string' as const,
          description: 'New Security Patch Level (YYYY-MM-DD format)'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof CheckDowngradeRiskSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'device') {
          throw new Error(
            `Device must be in ADB mode. Current: ${device.mode}. ` +
            `Downgrade check requires reading device properties.`
          );
        }

        // Get current device info
        const fingerprintResult = await CommandExecutor.shell(
          args.device_id,
          'getprop ro.build.fingerprint'
        );
        const splResult = await CommandExecutor.shell(
          args.device_id,
          'getprop ro.build.version.security_patch'
        );

        const currentFingerprint = fingerprintResult.success ? fingerprintResult.stdout.trim() : '';
        const currentSPL = splResult.success ? splResult.stdout.trim() : '';

        if (!args.new_build_fingerprint && !args.new_spl) {
          throw new Error(
            'Must provide either new_build_fingerprint or new_spl parameter to check.'
          );
        }

        const result: DowngradeCheckResult = {
          isDowngrade: false,
          riskLevel: 'none',
          warnings: [],
          currentSPL,
          newSPL: args.new_spl,
        };

        // Check fingerprint if provided
        if (args.new_build_fingerprint && currentFingerprint) {
          const fpCheck = ImageValidator.checkDowngradeRisk(
            currentFingerprint,
            args.new_build_fingerprint,
            currentSPL,
            args.new_spl
          );

          result.isDowngrade = fpCheck.isDowngrade;
          result.riskLevel = fpCheck.riskLevel;
          result.warnings.push(...fpCheck.warnings);

          // Extract dates for display
          const currentDateMatch = currentFingerprint.match(/:(\d{6})\//);
          const newDateMatch = args.new_build_fingerprint.match(/:(\d{6})\//);

          if (currentDateMatch) result.currentBuildDate = currentDateMatch[1];
          if (newDateMatch) result.newBuildDate = newDateMatch[1];
        }

        // Check SPL if provided
        if (args.new_spl && currentSPL) {
          const currentSPLDate = parseSPLDate(currentSPL);
          const newSPLDate = parseSPLDate(args.new_spl);

          if (currentSPLDate && newSPLDate && newSPLDate < currentSPLDate) {
            result.isDowngrade = true;
            result.riskLevel = 'high';
            result.warnings.push(
              `SPL downgrade: ${args.new_spl} is older than current ${currentSPL}`
            );
          }
        }

        if (args.format === 'json') {
          return JSON.stringify(result, null, 2);
        }

        let markdown = `# Downgrade Risk Check: ${args.device_id}\n\n`;

        // Risk level indicator
        const riskIcons: Record<string, string> = {
          none: '✅',
          low: '⚠️',
          medium: '⚠️',
          high: '🚨',
        };

        const riskIcon = riskIcons[result.riskLevel];
        markdown += `**Risk Level**: ${riskIcon} ${result.riskLevel.toUpperCase()}\n`;
        markdown += `**Is Downgrade**: ${result.isDowngrade ? '❌ YES' : '✅ No'}\n\n`;

        // Current firmware info
        markdown += `## Current Firmware\n\n`;
        if (currentFingerprint) {
          markdown += `**Fingerprint**: \`${currentFingerprint.substring(0, 60)}...\`\n`;
        }
        markdown += `**Security Patch Level**: ${currentSPL || 'Unknown'}\n`;
        if (result.currentBuildDate) {
          markdown += `**Build Date**: ${result.currentBuildDate}\n`;
        }

        // New firmware info
        markdown += `\n## New Firmware\n\n`;
        if (args.new_build_fingerprint) {
          markdown += `**Fingerprint**: \`${args.new_build_fingerprint.substring(0, 60)}...\`\n`;
        }
        if (args.new_spl) {
          markdown += `**Security Patch Level**: ${args.new_spl}\n`;
        }
        if (result.newBuildDate) {
          markdown += `**Build Date**: ${result.newBuildDate}\n`;
        }

        // Warnings
        if (result.warnings.length > 0) {
          markdown += `\n## ⚠️ Warnings\n\n`;
          for (const warning of result.warnings) {
            markdown += `- ${warning}\n`;
          }
        }

        // Recommendation
        markdown += `\n## Recommendation\n\n`;
        switch (result.riskLevel) {
          case 'high':
            markdown += `🚨 **DO NOT PROCEED** - Downgrade detected!\n\n`;
            markdown += `Flashing this firmware may trigger anti-rollback protection and BRICK your device.\n`;
            markdown += `The bootloader will refuse to boot if the SPL is older than the current one.\n`;
            break;
          case 'medium':
            markdown += `⚠️ **Proceed with caution** - Significant version difference.\n\n`;
            markdown += `Ensure you have verified the firmware is compatible with your device.\n`;
            break;
          case 'low':
            markdown += `⚠️ **Likely safe** - Minor version difference.\n\n`;
            markdown += `This appears to be a minor update or same version.\n`;
            break;
          case 'none':
            markdown += `✅ **Safe to proceed** - No downgrade detected.\n\n`;
            markdown += `The new firmware appears to be the same version or newer.\n`;
            break;
        }

        return markdown;
      });
    }
  },

  // Phase 2: Partition & Slot Management Tools

  switch_slot: {
    description: `Switch A/B partition slot with pre-flight validation.

Safely switches between A/B slots with automatic validation.

Pre-flight checks:
1. Verifies device is A/B partitioned
2. Gets current slot information
3. Validates target slot is bootable
4. Confirms switch with post-verification

Slot options:
- a: Switch to slot A
- b: Switch to slot B
- other: Switch to whichever slot is not current

This is non-destructive (no data loss) but may boot into different firmware if slots have different versions.

No confirmation token required (reversible operation).

Examples:
- switch_slot(device_id="ABC123", target_slot="b") → Switch to slot B
- switch_slot(device_id="ABC123", target_slot="other") → Switch to other slot`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID in fastboot mode'
        },
        target_slot: {
          type: 'string' as const,
          enum: ['a', 'b', 'other'],
          description: 'Target slot to switch to'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id', 'target_slot']
    },
    handler: async (args: z.infer<typeof SwitchSlotSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot mode. Current: ${device.mode}. ` +
            `Use reboot_device(device_id="${args.device_id}", mode="bootloader") first.`
          );
        }

        // Get current slot info
        const slotInfo = await AVBParser.getSlotInfo(args.device_id, 'fastboot');

        if (!slotInfo.isAB) {
          throw new Error(
            'Device does not have A/B partitions. Slot switching not supported.'
          );
        }

        // Determine target slot
        let targetSlot: 'a' | 'b';
        if (args.target_slot === 'other') {
          targetSlot = slotInfo.currentSlot === 'a' ? 'b' : 'a';
        } else {
          targetSlot = args.target_slot;
        }

        // Check if already on target slot
        if (slotInfo.currentSlot === targetSlot) {
          return ResponseFormatter.warning(
            `Device is already on slot ${targetSlot}. No action needed.`
          );
        }

        // Validate target slot is bootable
        const targetSlotInfo = targetSlot === 'a' ? slotInfo.slotA : slotInfo.slotB;
        if (targetSlotInfo && !targetSlotInfo.bootable) {
          throw new Error(
            `Slot ${targetSlot} is marked as not bootable. ` +
            `This may indicate corrupted firmware. Proceed with caution.`
          );
        }

        // Switch slot
        const result = await CommandExecutor.fastboot(args.device_id, [
          'set_active',
          targetSlot
        ]);

        if (!result.success) {
          throw new Error(`Failed to switch slot: ${result.stderr}`);
        }

        // Verify switch
        const newSlotInfo = await AVBParser.getSlotInfo(args.device_id, 'fastboot');

        if (args.format === 'json') {
          return JSON.stringify({
            success: true,
            previousSlot: slotInfo.currentSlot,
            currentSlot: newSlotInfo.currentSlot,
            targetSlot,
            slotInfo: newSlotInfo,
          }, null, 2);
        }

        DeviceManager.clearCache();

        let markdown = `# Slot Switch Complete\n\n`;
        markdown += `**Previous Slot**: ${slotInfo.currentSlot?.toUpperCase()}\n`;
        markdown += `**Current Slot**: ${newSlotInfo.currentSlot?.toUpperCase()}\n\n`;

        if (newSlotInfo.slotA && newSlotInfo.slotB) {
          markdown += `## Slot Status\n\n`;
          markdown += `| Slot | Bootable | Successful | Retries |\n`;
          markdown += `|------|----------|------------|----------|\n`;
          markdown += `| A${newSlotInfo.currentSlot === 'a' ? ' (active)' : ''} | ${newSlotInfo.slotA.bootable ? '✅' : '❌'} | ${newSlotInfo.slotA.successful ? '✅' : '❌'} | ${newSlotInfo.slotA.retryCount} |\n`;
          markdown += `| B${newSlotInfo.currentSlot === 'b' ? ' (active)' : ''} | ${newSlotInfo.slotB.bootable ? '✅' : '❌'} | ${newSlotInfo.slotB.successful ? '✅' : '❌'} | ${newSlotInfo.slotB.retryCount} |\n`;
        }

        markdown += `\n✅ Slot switched successfully. Reboot to boot from new slot.`;

        return markdown;
      });
    }
  },

  dump_partition_full: {
    description: `Enhanced partition backup with compression and metadata.

⚠️ REQUIRES ROOT ACCESS & CONFIRMATION TOKEN ⚠️

Advanced partition backup featuring:
- Optional gzip compression (significant size reduction)
- Device metadata collection (model, Android version, build ID)
- SHA256 checksum calculation
- Detailed progress reporting
- Automatic cleanup on failure

Compression typically reduces boot images by 40-60% and system images by 20-40%.

Output includes:
- Partition image (.img or .img.gz if compressed)
- SHA256 hash for verification
- Device metadata for identification
- Timing information

Requires:
- Rooted device in ADB mode
- Sufficient storage on device and PC
- Root permissions granted to shell

Generate token: CONFIRM_DUMP_PARTITION_FULL_<current_timestamp>

Examples:
- dump_partition_full(device_id="ABC123", partition_name="boot_a", output_path="/backups/boot_a.img", confirm_token="...", compress=true)
- dump_partition_full(device_id="ABC123", partition_name="system_a", output_path="/backups/system_a.img", confirm_token="...", include_metadata=true)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        partition_name: {
          type: 'string' as const,
          description: 'Partition name to backup (e.g., boot_a, system_a)'
        },
        output_path: {
          type: 'string' as const,
          description: 'Local output path for partition backup'
        },
        confirm_token: {
          type: 'string' as const,
          description: 'Confirmation token (format: CONFIRM_DUMP_PARTITION_FULL_<timestamp>)'
        },
        compress: {
          type: 'boolean' as const,
          default: false,
          description: 'Compress backup with gzip'
        },
        include_metadata: {
          type: 'boolean' as const,
          default: true,
          description: 'Include device metadata in backup'
        }
      },
      required: ['device_id', 'partition_name', 'output_path', 'confirm_token']
    },
    handler: async (args: z.infer<typeof DumpPartitionFullSchema>) => {
      return ErrorHandler.wrap(async () => {
        SafetyValidator.validateConfirmationToken('DUMP_PARTITION_FULL', args.confirm_token);

        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'device') {
          throw new Error(
            `Device must be in ADB mode. Current mode: ${device.mode}`
          );
        }

        // Check root access
        const rootCheck = await CommandExecutor.shell(args.device_id, 'su -c id');
        if (!rootCheck.success || !rootCheck.stdout.includes('uid=0')) {
          throw new Error(
            `Root access required for partition backup.\n\n` +
            `Possible solutions:\n` +
            `- Device must be rooted (Magisk, KernelSU, etc.)\n` +
            `- Grant root permissions to shell in root app`
          );
        }

        SafetyValidator.validatePartitionName(args.partition_name);

        console.error(`Starting enhanced partition dump: ${args.partition_name}...`);

        const backup = await PartitionManager.dumpPartitionFull(
          args.device_id,
          args.partition_name,
          args.output_path,
          {
            compress: args.compress,
            includeMetadata: args.include_metadata,
          }
        );

        let result = `# Enhanced Partition Backup Complete\n\n`;
        result += `**Partition**: ${backup.partition}\n`;
        result += `**Output Path**: ${backup.outputPath}\n`;
        result += `**Size**: ${backup.sizeHuman} (${backup.sizeBytes.toLocaleString()} bytes)\n`;

        if (backup.compressed && backup.compressedSize) {
          result += `**Compressed**: Yes (${backup.compressionRatio} reduction)\n`;
        }

        result += `**Duration**: ${backup.duration}\n`;
        result += `**Timestamp**: ${backup.timestamp}\n`;
        result += `**SHA256**: \`${backup.sha256}\`\n`;

        if (backup.metadata) {
          result += `\n## Device Metadata\n\n`;
          result += `| Property | Value |\n`;
          result += `|----------|-------|\n`;
          result += `| Model | ${backup.metadata.deviceModel} |\n`;
          result += `| Android | ${backup.metadata.androidVersion} |\n`;
          result += `| Build ID | ${backup.metadata.buildId} |\n`;
        }

        result += `\n✅ **Success**: Partition backed up successfully!\n`;
        result += `\n💡 **Tip**: Store the SHA256 hash for verification before restoring.`;

        return result;
      });
    }
  },

  compare_partitions: {
    description: `Compare two partition image files.

Performs binary comparison of two partition images to identify differences.

Features:
- SHA256 hash comparison (fast)
- Size difference calculation
- Optional detailed diff regions (shows exactly where files differ)
- Offset and length of each difference

Use cases:
- Verify patched vs stock boot images
- Compare backups from different dates
- Validate partition restoration
- Identify modifications in custom images

This is a READ-ONLY operation. No confirmation token required.

Examples:
- compare_partitions(file1_path="/backups/boot_stock.img", file2_path="/backups/boot_patched.img")
- compare_partitions(file1_path="/old/system.img", file2_path="/new/system.img", detailed=true)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        file1_path: {
          type: 'string' as const,
          description: 'Path to first partition image'
        },
        file2_path: {
          type: 'string' as const,
          description: 'Path to second partition image'
        },
        detailed: {
          type: 'boolean' as const,
          default: false,
          description: 'Show detailed diff regions'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['file1_path', 'file2_path']
    },
    handler: async (args: z.infer<typeof ComparePartitionsSchema>) => {
      return ErrorHandler.wrap(async () => {
        const comparison = await PartitionManager.comparePartitions(
          args.file1_path,
          args.file2_path,
          { detailed: args.detailed }
        );

        if (args.format === 'json') {
          return JSON.stringify(comparison, null, 2);
        }

        let markdown = `# Partition Comparison\n\n`;

        // Overall status
        const statusIcon = comparison.identical ? '✅' : '❌';
        markdown += `**Status**: ${statusIcon} ${comparison.identical ? 'IDENTICAL' : 'DIFFERENT'}\n\n`;

        // File info table
        markdown += `## File Information\n\n`;
        markdown += `| Property | File 1 | File 2 |\n`;
        markdown += `|----------|--------|--------|\n`;
        markdown += `| Path | ${comparison.file1.path} | ${comparison.file2.path} |\n`;
        markdown += `| Size | ${formatBytes(comparison.file1.size)} | ${formatBytes(comparison.file2.size)} |\n`;
        markdown += `| SHA256 | \`${comparison.file1.sha256.substring(0, 16)}...\` | \`${comparison.file2.sha256.substring(0, 16)}...\` |\n`;

        // Differences
        if (!comparison.identical) {
          markdown += `\n## Differences\n\n`;
          markdown += `**Size Difference**: ${formatBytes(comparison.differences.sizeDiff)}\n`;
          markdown += `**Hash Match**: ${comparison.differences.hashMatch ? 'Yes' : 'No'}\n`;

          if (comparison.differences.diffRegions && comparison.differences.diffRegions.length > 0) {
            markdown += `\n### Diff Regions (${comparison.differences.diffRegions.length})\n\n`;
            markdown += `| Offset | Length | Description |\n`;
            markdown += `|--------|--------|-------------|\n`;

            for (const region of comparison.differences.diffRegions.slice(0, 50)) {
              markdown += `| 0x${region.offset.toString(16)} | ${formatBytes(region.length)} | ${region.description} |\n`;
            }

            if (comparison.differences.diffRegions.length > 50) {
              markdown += `\n*...and ${comparison.differences.diffRegions.length - 50} more regions*\n`;
            }
          }
        }

        markdown += `\n## Summary\n\n`;
        if (comparison.identical) {
          markdown += `✅ Files are byte-for-byte identical.`;
        } else {
          markdown += `❌ Files differ. `;
          if (comparison.differences.sizeDiff > 0) {
            markdown += `Size difference of ${formatBytes(comparison.differences.sizeDiff)}.`;
          } else {
            markdown += `Same size but different content.`;
          }
        }

        return markdown;
      });
    }
  },

  list_partition_details: {
    description: `List all partitions with enhanced details.

Returns comprehensive partition information including:
- Partition name and block device path
- Size in bytes and human-readable format
- Filesystem type (if mounted)
- Mount point (if mounted)
- Read-only status
- A/B slot suffix
- Critical partition marking

Useful for:
- Understanding device storage layout
- Identifying mounted partitions
- Planning backup/restore operations
- Verifying slot configurations

This is a READ-ONLY operation. No confirmation token required.

Examples:
- list_partition_details(device_id="ABC123")
- list_partition_details(device_id="ABC123", format="json")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof ListPartitionDetailsSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'device') {
          throw new Error(
            `Device must be in ADB mode. Current mode: ${device.mode}`
          );
        }

        const partitions = await PartitionManager.listPartitionsDetailed(args.device_id);

        if (args.format === 'json') {
          return JSON.stringify(partitions, null, 2);
        }

        let markdown = `# Partition Details\n\n`;
        markdown += `**Device**: ${args.device_id}\n`;
        markdown += `**Total Partitions**: ${partitions.length}\n\n`;

        // Group by slot
        const slotA = partitions.filter(p => p.slot === 'a');
        const slotB = partitions.filter(p => p.slot === 'b');
        const noSlot = partitions.filter(p => p.slot === null);

        if (slotA.length > 0 || slotB.length > 0) {
          markdown += `**A/B Partitions**: Yes (${slotA.length} each slot)\n`;
          markdown += `**Non-slotted**: ${noSlot.length}\n\n`;
        }

        // Critical partitions first
        const critical = partitions.filter(p => p.critical);
        const other = partitions.filter(p => !p.critical);

        if (critical.length > 0) {
          markdown += `## Critical Partitions (${critical.length})\n\n`;
          markdown += `| Name | Size | FS Type | Mount | RO | Slot |\n`;
          markdown += `|------|------|---------|-------|-----|------|\n`;

          for (const p of critical) {
            const slot = p.slot ? p.slot.toUpperCase() : '-';
            const fsType = p.fsType || '-';
            const mount = p.mountPoint || '-';
            const ro = p.readonly ? '🔒' : '-';
            markdown += `| ⚠️ ${p.name} | ${p.sizeHuman} | ${fsType} | ${mount} | ${ro} | ${slot} |\n`;
          }
        }

        if (other.length > 0) {
          markdown += `\n## Other Partitions (${other.length})\n\n`;
          markdown += `| Name | Size | FS Type | Mount | RO | Slot |\n`;
          markdown += `|------|------|---------|-------|-----|------|\n`;

          for (const p of other) {
            const slot = p.slot ? p.slot.toUpperCase() : '-';
            const fsType = p.fsType || '-';
            const mount = p.mountPoint || '-';
            const ro = p.readonly ? '🔒' : '-';
            markdown += `| ${p.name} | ${p.sizeHuman} | ${fsType} | ${mount} | ${ro} | ${slot} |\n`;
          }
        }

        markdown += `\n💡 **Legend**: ⚠️ = Critical, 🔒 = Read-only`;

        return markdown;
      });
    }
  },

  verify_partition_integrity: {
    description: `Verify partition image integrity against expected hash.

Compares a partition image file against an expected SHA256 hash to verify integrity.

Use cases:
- Verify downloaded factory images
- Confirm backup integrity before restore
- Validate extracted OTA partitions
- Check for corruption

Supports:
- Direct SHA256 hash comparison
- Manifest file parsing (Google factory image format)

This is a READ-ONLY operation. No confirmation token required.

Examples:
- verify_partition_integrity(image_path="/downloads/boot.img", expected_sha256="abc123...", partition_name="boot")
- verify_partition_integrity(image_path="/factory/vendor.img", expected_sha256="def456...")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        image_path: {
          type: 'string' as const,
          description: 'Path to partition image file'
        },
        expected_sha256: {
          type: 'string' as const,
          description: 'Expected SHA256 hash'
        },
        partition_name: {
          type: 'string' as const,
          description: 'Partition name (for display)'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['image_path', 'expected_sha256']
    },
    handler: async (args: z.infer<typeof VerifyPartitionIntegritySchema>) => {
      return ErrorHandler.wrap(async () => {
        const partitionName = args.partition_name || args.image_path.split('/').pop() || 'unknown';

        const result = await PartitionManager.verifyPartitionIntegrity(
          args.image_path,
          args.expected_sha256,
          partitionName
        );

        if (args.format === 'json') {
          return JSON.stringify(result, null, 2);
        }

        let markdown = `# Partition Integrity Check\n\n`;

        // Overall status
        const statusIcon = result.valid ? '✅' : '❌';
        markdown += `**Status**: ${statusIcon} ${result.valid ? 'VERIFIED' : 'FAILED'}\n\n`;

        markdown += `## Details\n\n`;
        markdown += `| Property | Value |\n`;
        markdown += `|----------|-------|\n`;
        markdown += `| Partition | ${result.partition} |\n`;
        markdown += `| Size | ${result.details.sizeHuman} |\n`;
        markdown += `| Expected Hash | \`${result.expectedHash.substring(0, 24)}...\` |\n`;
        markdown += `| Actual Hash | \`${result.actualHash.substring(0, 24)}...\` |\n`;
        markdown += `| Match | ${result.valid ? '✅ Yes' : '❌ No'} |\n`;

        if (result.error) {
          markdown += `\n## ❌ Error\n\n${result.error}\n`;
        }

        markdown += `\n## Recommendation\n\n`;
        if (result.valid) {
          markdown += `✅ Image integrity verified. Safe to use.\n`;
        } else {
          markdown += `❌ **DO NOT USE** - Hash mismatch detected!\n\n`;
          markdown += `Possible causes:\n`;
          markdown += `- File corrupted during download\n`;
          markdown += `- File modified after creation\n`;
          markdown += `- Wrong file selected\n`;
          markdown += `- Wrong expected hash provided\n`;
        }

        return markdown;
      });
    }
  }
};

// Helper function to parse SPL date
function parseSPLDate(spl: string): number | null {
  const match = spl.match(/(\d{4})-(\d{2})(?:-(\d{2}))?/);
  if (!match) return null;

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = match[3] ? parseInt(match[3], 10) : 1;

  return year * 10000 + month * 100 + day;
}
