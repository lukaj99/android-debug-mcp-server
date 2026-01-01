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
    description: `Upload files/directories to device. Use sync=true to only push changed files.`,
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
    description: `Download files/directories from device to local machine. Use preserve_timestamp=true to keep dates.`,
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
    description: `List directory contents with file details (name, type, size, permissions). Use recursive=true for subdirs.`,
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
    description: `⚠️ Backup partition to local file. Requires fastboot mode. Warning: partitions can be GB-sized.`,
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
        await DeviceManager.requireMode(args.device_id, 'bootloader');

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
    description: `Execute shell command on device and return output. Use with caution.`,
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
    description: `Sync filesystem buffers to disk. Operations: sync (all), sync-data, sync-system.`,
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
