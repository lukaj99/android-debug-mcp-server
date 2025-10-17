/**
 * Flashing & rooting tools (DESTRUCTIVE OPERATIONS)
 */

import { z } from 'zod';
import { DeviceManager } from '../utils/device-manager.js';
import { CommandExecutor } from '../utils/executor.js';
import { ResponseFormatter } from '../utils/formatter.js';
import { SafetyValidator } from '../utils/validator.js';
import { ErrorHandler } from '../utils/error-handler.js';
// Types imported but handled inline

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
  }
};
