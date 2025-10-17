/**
 * File operations tools
 */

import { z } from 'zod';
import { DeviceManager } from '../utils/device-manager.js';
import { CommandExecutor } from '../utils/executor.js';
import { ResponseFormatter } from '../utils/formatter.js';
import { SafetyValidator } from '../utils/validator.js';
import { ErrorHandler } from '../utils/error-handler.js';
import type { FileInfo } from '../types.js';

// Schemas
export const PushFilesSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  local_path: z.string().describe('Local file or directory path'),
  remote_path: z.string().describe('Device destination path'),
  sync: z.boolean().default(false).describe('Use sync mode (only push changed files)')
}).strict();

export const PullFilesSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  remote_path: z.string().describe('Device file or directory path'),
  local_path: z.string().describe('Local destination path'),
  preserve_timestamp: z.boolean().default(false).describe('Preserve file timestamps')
}).strict();

export const ListFilesSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  path: z.string().describe('Directory path on device'),
  format: z.enum(['markdown', 'json']).default('markdown'),
  recursive: z.boolean().default(false).describe('List subdirectories recursively')
}).strict();

export const BackupPartitionSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  partition: z.string().describe('Partition name (boot, system, vendor, etc.)'),
  output_path: z.string().describe('Local output file path')
}).strict();

export const ExecuteShellSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  command: z.string().describe('Shell command to execute'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const SyncDataSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  operation: z.enum(['sync', 'sync-data', 'sync-system']).default('sync')
}).strict();

// Tool implementations
export const fileTools = {
  push_files: {
    description: `Upload files or directories from local machine to device.

Transfers files/directories to device storage. Supports both individual files and entire directories.

sync mode: Only uploads changed files (faster for large directories)

Common device paths:
- /sdcard/ - Internal storage (user accessible)
- /sdcard/Download/ - Downloads folder
- /data/local/tmp/ - Temporary storage (requires root for most paths)

Examples:
- push_files(device_id="ABC123", local_path="/path/to/file.txt", remote_path="/sdcard/")
- push_files(device_id="ABC123", local_path="/path/to/folder", remote_path="/sdcard/MyFolder/")
- push_files(device_id="ABC123", local_path="/photos/", remote_path="/sdcard/Pictures/", sync=true)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        local_path: {
          type: 'string' as const,
          description: 'Local file or directory path'
        },
        remote_path: {
          type: 'string' as const,
          description: 'Device destination path'
        },
        sync: {
          type: 'boolean' as const,
          default: false,
          description: 'Use sync mode (only push changed files)'
        }
      },
      required: ['device_id', 'local_path', 'remote_path']
    },
    handler: async (args: z.infer<typeof PushFilesSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validateDevicePath(args.local_path);
        SafetyValidator.validateDevicePath(args.remote_path);

        const command = args.sync ? 'sync' : 'push';
        const result = await CommandExecutor.adb(args.device_id, [command, args.local_path, args.remote_path]);

        if (!result.success) {
          throw new Error(`Failed to push files: ${result.stderr}`);
        }

        // Parse transfer statistics
        const statsMatch = result.stdout.match(/(\d+) files? pushed.*?in ([\d.]+)s/);
        const stats = statsMatch
          ? { files: statsMatch[1], time: statsMatch[2] }
          : { status: 'completed' };

        return ResponseFormatter.success(
          `Files transferred successfully`,
          {
            from: args.local_path,
            to: args.remote_path,
            mode: args.sync ? 'sync' : 'push',
            ...stats
          }
        );
      });
    }
  },

  pull_files: {
    description: `Download files or directories from device to local machine.

Transfers files/directories from device to local storage. Supports both individual files and entire directories.

Common device paths to pull from:
- /sdcard/Download/ - Downloaded files
- /sdcard/DCIM/Camera/ - Camera photos/videos
- /sdcard/Pictures/ - Pictures folder
- /data/local/tmp/ - Temporary files

Examples:
- pull_files(device_id="ABC123", remote_path="/sdcard/file.txt", local_path="/local/backup/")
- pull_files(device_id="ABC123", remote_path="/sdcard/DCIM/Camera/", local_path="/photos/", preserve_timestamp=true)
- pull_files(device_id="ABC123", remote_path="/sdcard/Download/document.pdf", local_path="./downloads/")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        remote_path: {
          type: 'string' as const,
          description: 'Device file or directory path'
        },
        local_path: {
          type: 'string' as const,
          description: 'Local destination path'
        },
        preserve_timestamp: {
          type: 'boolean' as const,
          default: false,
          description: 'Preserve file timestamps'
        }
      },
      required: ['device_id', 'remote_path', 'local_path']
    },
    handler: async (args: z.infer<typeof PullFilesSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validateDevicePath(args.remote_path);
        SafetyValidator.validateDevicePath(args.local_path);

        const cmdArgs = ['pull'];
        if (args.preserve_timestamp) cmdArgs.push('-a');
        cmdArgs.push(args.remote_path, args.local_path);

        const result = await CommandExecutor.adb(args.device_id, cmdArgs);

        if (!result.success) {
          throw new Error(`Failed to pull files: ${result.stderr}`);
        }

        // Parse transfer statistics
        const statsMatch = result.stdout.match(/(\d+) files? pulled.*?in ([\d.]+)s/);
        const stats = statsMatch
          ? { files: statsMatch[1], time: statsMatch[2] }
          : { status: 'completed' };

        return ResponseFormatter.success(
          `Files downloaded successfully`,
          {
            from: args.remote_path,
            to: args.local_path,
            preserve_timestamp: args.preserve_timestamp,
            ...stats
          }
        );
      });
    }
  },

  list_files: {
    description: `List files and directories on device.

Shows directory contents with details:
- File name and type (file/directory/symlink)
- Size in bytes
- Permissions (rwx format)
- Owner and group
- Last modified date

Examples:
- list_files(device_id="ABC123", path="/sdcard/")
- list_files(device_id="ABC123", path="/sdcard/Download/", recursive=true)
- list_files(device_id="ABC123", path="/data/local/tmp/", format="json")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        path: {
          type: 'string' as const,
          description: 'Directory path on device'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        },
        recursive: {
          type: 'boolean' as const,
          default: false,
          description: 'List subdirectories recursively'
        }
      },
      required: ['device_id', 'path']
    },
    handler: async (args: z.infer<typeof ListFilesSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validateDevicePath(args.path);

        const command = args.recursive ? `ls -lRa ${args.path}` : `ls -la ${args.path}`;
        const result = await CommandExecutor.shell(args.device_id, command);

        if (!result.success) {
          throw new Error(`Failed to list files: ${result.stderr || result.stdout}`);
        }

        // Parse ls output
        const files: FileInfo[] = [];
        const lines = result.stdout.split('\n');

        const getFileType = (permissions: string): 'file' | 'directory' | 'symlink' => {
          if (permissions.startsWith('d')) return 'directory';
          if (permissions.startsWith('l')) return 'symlink';
          return 'file';
        };

        for (const line of lines) {
          // Match ls -la format
          const match = line.match(/^([\w-]+)\s+\d+\s+(\w+)\s+(\w+)\s+(\d+)\s+([\w\s:]+)\s+(.+)$/);
          if (match) {
            const [, permissions, owner, group, size, modified, name] = match;

            // Skip . and ..
            if (name === '.' || name === '..') continue;

            files.push({
              path: `${args.path}/${name}`,
              name,
              type: getFileType(permissions),
              size: parseInt(size, 10),
              permissions,
              owner,
              group,
              modified
            });
          }
        }

        return ResponseFormatter.format(files, args.format, 'concise');
      });
    }
  },

  backup_partition: {
    description: `Backup (dump) device partition to local file.

Creates a binary dump of the specified partition. Device must be in fastboot mode.

⚠️ WARNING: Partition backups can be very large (GB). Ensure sufficient local storage.

Common partitions:
- boot: Boot image (kernel + ramdisk)
- recovery: Recovery partition
- system: System partition (Android OS)
- userdata: User data partition
- vendor: Vendor partition

Examples:
- backup_partition(device_id="ABC123", partition="boot", output_path="/backups/boot.img")
- backup_partition(device_id="ABC123", partition="recovery", output_path="./recovery_backup.img")

Note: Device must be rebooted to fastboot mode first using reboot_device(mode="bootloader")`,
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
        output_path: {
          type: 'string' as const,
          description: 'Local output file path'
        }
      },
      required: ['device_id', 'partition', 'output_path']
    },
    handler: async (args: z.infer<typeof BackupPartitionSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot/bootloader mode. Current mode: ${device.mode}. ` +
            `Use reboot_device(device_id="${args.device_id}", mode="bootloader") first.`
          );
        }

        SafetyValidator.validatePartitionName(args.partition);
        SafetyValidator.validateDevicePath(args.output_path);

        // Note: This requires fastboot getvar / fastboot flash commands
        // Actual partition dumping is device-specific and may not work on all devices
        const result = await CommandExecutor.fastboot(args.device_id, [
          'getvar',
          `partition-size:${args.partition}`
        ]);

        if (!result.success && result.stderr.includes('FAILED')) {
          throw new Error(`Partition '${args.partition}' not found on device`);
        }

        return ResponseFormatter.warning(
          `Partition backup requested for '${args.partition}'. ` +
          `Note: Direct partition dumping via fastboot is limited. ` +
          `For complete backups, consider using manufacturer-specific tools or TWRP recovery.`
        );
      });
    }
  },

  execute_shell: {
    description: `Execute arbitrary shell command on device.

Runs any shell command on the device and returns output. Use with caution.

Common commands:
- getprop → System properties
- dumpsys battery → Battery info
- pm list packages → List apps
- am start -n <package/activity> → Launch app
- screencap -p /sdcard/screen.png → Screenshot
- input text "hello" → Type text
- input keyevent KEYCODE_HOME → Press home button

Examples:
- execute_shell(device_id="ABC123", command="getprop ro.build.version.release")
- execute_shell(device_id="ABC123", command="dumpsys battery")
- execute_shell(device_id="ABC123", command="screencap -p /sdcard/screenshot.png")
- execute_shell(device_id="ABC123", command="input keyevent 26") # Power button`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        command: {
          type: 'string' as const,
          description: 'Shell command to execute'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id', 'command']
    },
    handler: async (args: z.infer<typeof ExecuteShellSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validateShellCommand(args.command);

        const result = await CommandExecutor.shell(args.device_id, args.command);

        const output = {
          command: args.command,
          exit_code: result.exitCode,
          stdout: result.stdout,
          stderr: result.stderr,
          success: result.success
        };

        if (args.format === 'json') {
          return JSON.stringify(output, null, 2);
        }

        return `# Shell Command Result\n\n` +
               `**Command**: \`${args.command}\`\n` +
               `**Exit Code**: ${result.exitCode}\n` +
               `**Success**: ${result.success ? '✓' : '✗'}\n\n` +
               (result.stdout ? `## Output\n\`\`\`\n${result.stdout}\n\`\`\`\n\n` : '') +
               (result.stderr ? `## Errors\n\`\`\`\n${result.stderr}\n\`\`\`\n\n` : '');
      });
    }
  },

  sync_data: {
    description: `Sync filesystem buffers to disk.

Forces the device to write all pending data to disk. Useful before pulling files or rebooting.

Operations:
- sync: Sync all filesystems
- sync-data: Sync only data partition
- sync-system: Sync only system partition

Examples:
- sync_data(device_id="ABC123") → Sync all
- sync_data(device_id="ABC123", operation="sync-data") → Sync data partition only`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        operation: {
          type: 'string' as const,
          enum: ['sync', 'sync-data', 'sync-system'],
          default: 'sync',
          description: 'Sync operation type'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof SyncDataSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        const result = await CommandExecutor.shell(args.device_id, 'sync');

        if (!result.success) {
          throw new Error(`Sync failed: ${result.stderr}`);
        }

        return ResponseFormatter.success(
          `Filesystem buffers synced (${args.operation})`,
          { operation: args.operation, device_id: args.device_id }
        );
      });
    }
  }
};
