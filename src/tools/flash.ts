/**
 * Flashing & rooting tools (DESTRUCTIVE OPERATIONS)
 */

import { z } from 'zod';
import { DeviceManager } from '../utils/device-manager.js';
import { CommandExecutor } from '../utils/executor.js';
import { ResponseFormatter, formatBytes } from '../utils/formatter.js';
import { SafetyValidator } from '../utils/validator.js';
import { ErrorHandler } from '../utils/error-handler.js';
import type { PartitionInfo, PartitionBackup } from '../types.js';
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
  }
};
