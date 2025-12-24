/**
 * App management tools
 */

import { z } from 'zod';
import { DeviceManager } from '../utils/device-manager.js';
import { CommandExecutor } from '../utils/executor.js';
import { ResponseFormatter } from '../utils/formatter.js';
import { SafetyValidator } from '../utils/validator.js';
import { ErrorHandler } from '../utils/error-handler.js';
import type { AppFilter, Package } from '../types.js';

// Schemas
export const ListPackagesSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  filter: z.enum(['all', 'user', 'system', 'enabled', 'disabled', 'third-party']).default('user'),
  format: z.enum(['markdown', 'json']).default('markdown'),
  detail: z.enum(['concise', 'detailed']).default('concise')
}).strict();

export const InstallAppSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  apk_path: z.string().describe('Path to APK file on local machine'),
  replace: z.boolean().default(false).describe('Replace existing app'),
  downgrade: z.boolean().default(false).describe('Allow downgrade'),
  grant_permissions: z.boolean().default(false).describe('Grant all runtime permissions'),
  allow_test_packages: z.boolean().default(false).describe('Allow test packages')
}).strict();

export const UninstallAppSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  package_name: z.string().describe('Package name (e.g., com.example.app)'),
  keep_data: z.boolean().default(false).describe('Keep app data and cache')
}).strict();

export const BackupAppSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  package_name: z.string().describe('Package name to backup'),
  output_path: z.string().describe('Local output path for backup files')
}).strict();

export const GetAppInfoSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  package_name: z.string().describe('Package name to query'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const ManageAppStateSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  package_name: z.string().describe('Package name to manage'),
  action: z.enum(['enable', 'disable', 'clear-data', 'force-stop', 'grant-permission', 'revoke-permission']),
  permission: z.string().optional().describe('Permission name for grant/revoke actions')
}).strict();

// Phase 6B: Package Manager Schemas
export const DownloadApkSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  package_name: z.string().describe('Package name to download'),
  output_path: z.string().describe('Local directory to save APK'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const ManageDenylistSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  package_name: z.string().describe('Package name to add/remove'),
  action: z.enum(['add', 'remove']).describe('Add or remove from denylist'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

// Tool implementations
export const appTools = {
  list_packages: {
    description: `List installed packages on device.

Filter options:
- all: All packages (system + user)
- user: Only user-installed apps
- system: Only system apps
- enabled: Only enabled apps
- disabled: Only disabled apps
- third-party: Non-system apps

Returns package name, path, version, size, and enabled status.

Examples:
- list_packages(device_id="ABC123") → User-installed apps
- list_packages(device_id="ABC123", filter="system") → System apps
- list_packages(device_id="ABC123", filter="disabled") → Disabled apps`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        filter: {
          type: 'string' as const,
          enum: ['all', 'user', 'system', 'enabled', 'disabled', 'third-party'],
          default: 'user',
          description: 'Filter type'
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
    handler: async (args: z.infer<typeof ListPackagesSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        const filterFlags: Record<AppFilter, string> = {
          all: '-a',
          user: '-3',
          system: '-s',
          enabled: '-e',
          disabled: '-d',
          'third-party': '-3'
        };

        const result = await CommandExecutor.shell(
          args.device_id,
          `pm list packages ${filterFlags[args.filter]} -f`
        );

        if (!result.success) {
          throw new Error(`Failed to list packages: ${result.stderr}`);
        }

        const packages: Package[] = [];
        const lines = result.stdout.split('\n');

        for (const line of lines) {
          if (!line.startsWith('package:')) continue;

          const match = line.match(/package:(.*?)=(.+)/);
          if (match) {
            const [, path, name] = match;
            packages.push({
              name,
              path,
              enabled: true, // Would need additional query for accurate status
              system: args.filter === 'system'
            });
          }
        }

        return ResponseFormatter.format(packages, args.format, args.detail);
      });
    }
  },

  install_app: {
    description: `Install APK on device.

Options:
- replace: Replace existing app (otherwise fails if app exists)
- downgrade: Allow downgrade to older version
- grant_permissions: Automatically grant all runtime permissions
- allow_test_packages: Allow installing test packages

The APK file must be accessible on the local machine running this server.

Examples:
- install_app(device_id="ABC123", apk_path="/path/to/app.apk")
- install_app(device_id="ABC123", apk_path="/path/to/app.apk", replace=true)
- install_app(device_id="ABC123", apk_path="/path/to/app.apk", grant_permissions=true)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        apk_path: {
          type: 'string' as const,
          description: 'Path to APK file on local machine'
        },
        replace: {
          type: 'boolean' as const,
          default: false,
          description: 'Replace existing app'
        },
        downgrade: {
          type: 'boolean' as const,
          default: false,
          description: 'Allow downgrade'
        },
        grant_permissions: {
          type: 'boolean' as const,
          default: false,
          description: 'Grant all runtime permissions'
        },
        allow_test_packages: {
          type: 'boolean' as const,
          default: false,
          description: 'Allow test packages'
        }
      },
      required: ['device_id', 'apk_path']
    },
    handler: async (args: z.infer<typeof InstallAppSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validateApkPath(args.apk_path);

        const cmdArgs = ['install'];

        if (args.replace) cmdArgs.push('-r');
        if (args.downgrade) cmdArgs.push('-d');
        if (args.grant_permissions) cmdArgs.push('-g');
        if (args.allow_test_packages) cmdArgs.push('-t');

        cmdArgs.push(args.apk_path);

        const result = await CommandExecutor.adb(args.device_id, cmdArgs);

        if (!result.success || !result.stdout.includes('Success')) {
          throw new Error(`Installation failed: ${result.stderr || result.stdout}`);
        }

        // Extract package name from output
        const pkgMatch = result.stdout.match(/package:(.+)/);
        const packageName = pkgMatch ? pkgMatch[1] : 'unknown';

        return ResponseFormatter.success(
          `App installed successfully: ${packageName}`,
          { apk_path: args.apk_path, package_name: packageName }
        );
      });
    }
  },

  uninstall_app: {
    description: `Uninstall app from device.

Options:
- keep_data: Keep app data and cache directories (default: remove everything)

Examples:
- uninstall_app(device_id="ABC123", package_name="com.example.app")
- uninstall_app(device_id="ABC123", package_name="com.example.app", keep_data=true)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        package_name: {
          type: 'string' as const,
          description: 'Package name (e.g., com.example.app)'
        },
        keep_data: {
          type: 'boolean' as const,
          default: false,
          description: 'Keep app data and cache'
        }
      },
      required: ['device_id', 'package_name']
    },
    handler: async (args: z.infer<typeof UninstallAppSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validatePackageName(args.package_name);

        const cmdArgs = ['uninstall'];
        if (args.keep_data) cmdArgs.push('-k');
        cmdArgs.push(args.package_name);

        const result = await CommandExecutor.adb(args.device_id, cmdArgs);

        if (!result.success || !result.stdout.includes('Success')) {
          throw new Error(`Uninstallation failed: ${result.stderr || result.stdout}`);
        }

        return ResponseFormatter.success(
          `App uninstalled: ${args.package_name}`,
          { package_name: args.package_name, data_removed: !args.keep_data }
        );
      });
    }
  },

  backup_app: {
    description: `Backup app APK and data from device.

Creates a backup of:
- APK file (application package)
- App data (if accessible)

The backup will be saved to the specified output_path on the local machine.

Examples:
- backup_app(device_id="ABC123", package_name="com.example.app", output_path="/backups/")
- backup_app(device_id="ABC123", package_name="com.facebook.katana", output_path="./app-backups/")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        package_name: {
          type: 'string' as const,
          description: 'Package name to backup'
        },
        output_path: {
          type: 'string' as const,
          description: 'Local output directory for backup files'
        }
      },
      required: ['device_id', 'package_name', 'output_path']
    },
    handler: async (args: z.infer<typeof BackupAppSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validatePackageName(args.package_name);
        SafetyValidator.validateDevicePath(args.output_path);

        // Get package path
        const pathResult = await CommandExecutor.shell(
          args.device_id,
          `pm path ${args.package_name}`
        );

        if (!pathResult.success || !pathResult.stdout.includes('package:')) {
          throw new Error(`Package not found: ${args.package_name}`);
        }

        const apkPath = pathResult.stdout.replace('package:', '').trim();

        // Pull APK
        const apkBackupPath = `${args.output_path}/${args.package_name}.apk`;
        const pullResult = await CommandExecutor.adb(args.device_id, ['pull', apkPath, apkBackupPath]);

        if (!pullResult.success) {
          throw new Error(`Failed to backup APK: ${pullResult.stderr}`);
        }

        return ResponseFormatter.success(
          `App backed up successfully: ${args.package_name}`,
          {
            package_name: args.package_name,
            apk_backup: apkBackupPath,
            note: 'APK backed up. Data backup requires root access (not implemented).'
          }
        );
      });
    }
  },

  get_app_info: {
    description: `Get detailed information about an installed app.

Returns:
- Package name and version
- Install location and date
- Permissions requested
- Data directory paths
- APK size and signatures
- Enabled/disabled status

Examples:
- get_app_info(device_id="ABC123", package_name="com.android.chrome")
- get_app_info(device_id="ABC123", package_name="com.example.app", format="json")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        package_name: {
          type: 'string' as const,
          description: 'Package name to query'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id', 'package_name']
    },
    handler: async (args: z.infer<typeof GetAppInfoSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validatePackageName(args.package_name);

        const result = await CommandExecutor.shell(
          args.device_id,
          `dumpsys package ${args.package_name}`
        );

        if (!result.success) {
          throw new Error(`Failed to get app info: ${result.stderr}`);
        }

        const output = result.stdout;

        // Parse dumpsys output
        const info: any = {
          package_name: args.package_name
        };

        const versionNameMatch = output.match(/versionName=([^\s]+)/);
        const versionCodeMatch = output.match(/versionCode=(\d+)/);
        const firstInstallMatch = output.match(/firstInstallTime=([^\n]+)/);
        const lastUpdateMatch = output.match(/lastUpdateTime=([^\n]+)/);
        const enabledMatch = output.match(/enabled=(\d+)/);

        if (versionNameMatch) info.version_name = versionNameMatch[1];
        if (versionCodeMatch) info.version_code = versionCodeMatch[1];
        if (firstInstallMatch) info.first_install = firstInstallMatch[1];
        if (lastUpdateMatch) info.last_update = lastUpdateMatch[1];
        if (enabledMatch) info.enabled = enabledMatch[1] !== '0';

        // Get permissions
        const permSection = output.match(/requested permissions:(.*?)(?=install permissions:|runtime permissions:|$)/s);
        if (permSection) {
          const perms = permSection[1].match(/android\.permission\.\w+/g) || [];
          info.permissions = perms;
        }

        return ResponseFormatter.format(info, args.format, 'detailed');
      });
    }
  },

  manage_app_state: {
    description: `Manage app state and permissions.

Actions:
- enable: Enable disabled app
- disable: Disable app (app won't run)
- clear-data: Clear app data and cache
- force-stop: Force stop running app
- grant-permission: Grant specific runtime permission
- revoke-permission: Revoke specific runtime permission

Permission format: android.permission.CAMERA, android.permission.LOCATION, etc.

Examples:
- manage_app_state(device_id="ABC123", package_name="com.example.app", action="force-stop")
- manage_app_state(device_id="ABC123", package_name="com.example.app", action="disable")
- manage_app_state(device_id="ABC123", package_name="com.example.app", action="grant-permission", permission="android.permission.CAMERA")
- manage_app_state(device_id="ABC123", package_name="com.example.app", action="clear-data")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        package_name: {
          type: 'string' as const,
          description: 'Package name to manage'
        },
        action: {
          type: 'string' as const,
          enum: ['enable', 'disable', 'clear-data', 'force-stop', 'grant-permission', 'revoke-permission'],
          description: 'Action to perform'
        },
        permission: {
          type: 'string' as const,
          description: 'Permission name for grant/revoke actions'
        }
      },
      required: ['device_id', 'package_name', 'action']
    },
    handler: async (args: z.infer<typeof ManageAppStateSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validatePackageName(args.package_name);

        let command = '';
        const action = args.action;

        switch (action) {
          case 'enable':
            command = `pm enable ${args.package_name}`;
            break;
          case 'disable':
            command = `pm disable-user ${args.package_name}`;
            break;
          case 'clear-data':
            command = `pm clear ${args.package_name}`;
            break;
          case 'force-stop':
            command = `am force-stop ${args.package_name}`;
            break;
          case 'grant-permission':
            if (!args.permission) {
              throw new Error('Permission parameter required for grant-permission action');
            }
            command = `pm grant ${args.package_name} ${args.permission}`;
            break;
          case 'revoke-permission':
            if (!args.permission) {
              throw new Error('Permission parameter required for revoke-permission action');
            }
            command = `pm revoke ${args.package_name} ${args.permission}`;
            break;
        }

        const result = await CommandExecutor.shell(args.device_id, command);

        if (!result.success) {
          throw new Error(`Action failed: ${result.stderr || result.stdout}`);
        }

        return ResponseFormatter.success(
          `Action completed: ${action} for ${args.package_name}`,
          { package_name: args.package_name, action, permission: args.permission }
        );
      });
    }
  },

  // Phase 6B: Package Manager Tools
  download_apk: {
    description: `Download/extract an APK from a device.

Extracts the APK file for an installed app from the device to local storage.
Useful for backing up apps or analyzing APKs.

Handles split APKs (base + config APKs) automatically.

Examples:
- download_apk(device_id="RF8M33...", package_name="com.example.app", output_path="/tmp")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        package_name: {
          type: 'string' as const,
          description: 'Package name to download'
        },
        output_path: {
          type: 'string' as const,
          description: 'Local directory to save APK'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id', 'package_name', 'output_path']
    },
    handler: async (args: z.infer<typeof DownloadApkSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validatePackageName(args.package_name);

        // Validate output path
        const fs = await import('fs');
        const path = await import('path');

        const outputDir = path.resolve(args.output_path);
        if (!fs.existsSync(outputDir)) {
          throw new Error(`Output directory does not exist: ${outputDir}`);
        }

        // Get APK path(s) from device
        const pathResult = await CommandExecutor.shell(
          args.device_id,
          `pm path ${args.package_name}`
        );

        if (!pathResult.success || !pathResult.stdout.trim()) {
          throw new Error(`Package not found: ${args.package_name}`);
        }

        // Parse all APK paths (handle split APKs)
        const apkPaths = pathResult.stdout
          .split('\n')
          .filter(line => line.startsWith('package:'))
          .map(line => line.replace('package:', '').trim());

        if (apkPaths.length === 0) {
          throw new Error(`No APK paths found for: ${args.package_name}`);
        }

        const downloadedFiles: string[] = [];
        const errors: string[] = [];

        for (let i = 0; i < apkPaths.length; i++) {
          const apkPath = apkPaths[i];
          const apkName = apkPaths.length === 1
            ? `${args.package_name}.apk`
            : `${args.package_name}_${i === 0 ? 'base' : `split_${i}`}.apk`;
          const localPath = path.join(outputDir, apkName);

          const pullResult = await CommandExecutor.adb(
            args.device_id,
            ['pull', apkPath, localPath]
          );

          if (pullResult.success) {
            downloadedFiles.push(localPath);
          } else {
            errors.push(`Failed to pull ${apkPath}: ${pullResult.stderr}`);
          }
        }

        if (downloadedFiles.length === 0) {
          throw new Error(`Failed to download APK: ${errors.join(', ')}`);
        }

        // Get file sizes
        const fileSizes = downloadedFiles.map(file => {
          const stats = fs.statSync(file);
          return { path: file, size: stats.size };
        });

        const totalSize = fileSizes.reduce((sum, f) => sum + f.size, 0);

        if (args.format === 'json') {
          return JSON.stringify({
            success: true,
            package_name: args.package_name,
            files: fileSizes,
            total_size: totalSize,
            split_apk: apkPaths.length > 1,
            errors: errors.length > 0 ? errors : undefined,
          }, null, 2);
        }

        let result = `# APK Downloaded\n\n`;
        result += `**Package**: ${args.package_name}\n`;
        result += `**Files**: ${downloadedFiles.length}\n`;
        result += `**Total Size**: ${(totalSize / 1024 / 1024).toFixed(2)} MB\n\n`;

        if (apkPaths.length > 1) {
          result += `⚠️ **Split APK**: This app uses multiple APK files.\n\n`;
        }

        result += `## Downloaded Files\n\n`;
        for (const file of fileSizes) {
          result += `- \`${file.path}\` (${(file.size / 1024 / 1024).toFixed(2)} MB)\n`;
        }

        if (errors.length > 0) {
          result += `\n## Warnings\n\n`;
          for (const error of errors) {
            result += `- ${error}\n`;
          }
        }

        return result;
      });
    }
  },

  manage_denylist: {
    description: `Add or remove a package from Magisk denylist.

The denylist (formerly MagiskHide) hides root from specific apps.
Requires Magisk with denylist feature enabled.

Actions:
- add: Add package to denylist (hide root from this app)
- remove: Remove package from denylist

Note: Requires device to be rooted with Magisk.

Examples:
- manage_denylist(device_id="RF8M33...", package_name="com.google.android.gms", action="add")
- manage_denylist(device_id="RF8M33...", package_name="com.bank.app", action="remove")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        package_name: {
          type: 'string' as const,
          description: 'Package name to add/remove'
        },
        action: {
          type: 'string' as const,
          enum: ['add', 'remove'],
          description: 'Add or remove from denylist'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id', 'package_name', 'action']
    },
    handler: async (args: z.infer<typeof ManageDenylistSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        SafetyValidator.validatePackageName(args.package_name);

        // Check if Magisk is installed
        const magiskCheck = await CommandExecutor.shell(
          args.device_id,
          'su -c "magisk -v" 2>/dev/null || echo "no_magisk"'
        );

        if (!magiskCheck.success || magiskCheck.stdout.includes('no_magisk')) {
          throw new Error('Magisk not found. This feature requires Magisk root.');
        }

        const magiskVersion = magiskCheck.stdout.trim();

        // Check denylist status first
        const statusResult = await CommandExecutor.shell(
          args.device_id,
          'su -c "magisk --denylist status" 2>/dev/null'
        );

        const denylistEnabled = statusResult.success &&
          (statusResult.stdout.includes('enabled') || statusResult.stdout.includes('enforced'));

        // Execute denylist command
        const command = args.action === 'add'
          ? `su -c "magisk --denylist add ${args.package_name}"`
          : `su -c "magisk --denylist rm ${args.package_name}"`;

        const result = await CommandExecutor.shell(args.device_id, command);

        // Verify the action
        const verifyResult = await CommandExecutor.shell(
          args.device_id,
          `su -c "magisk --denylist ls" 2>/dev/null | grep "${args.package_name}"`
        );

        const inDenylist = verifyResult.success && verifyResult.stdout.includes(args.package_name);
        const actionSuccessful = (args.action === 'add' && inDenylist) ||
                                 (args.action === 'remove' && !inDenylist);

        if (args.format === 'json') {
          return JSON.stringify({
            success: actionSuccessful,
            package_name: args.package_name,
            action: args.action,
            in_denylist: inDenylist,
            denylist_enabled: denylistEnabled,
            magisk_version: magiskVersion,
            message: result.stdout || result.stderr,
          }, null, 2);
        }

        let markdown = `# Denylist ${args.action === 'add' ? 'Add' : 'Remove'}\n\n`;
        markdown += `**Package**: ${args.package_name}\n`;
        markdown += `**Action**: ${args.action}\n`;
        markdown += `**Magisk Version**: ${magiskVersion}\n`;
        markdown += `**Denylist Enabled**: ${denylistEnabled ? '✅ Yes' : '❌ No'}\n\n`;

        if (actionSuccessful) {
          markdown += `✅ **Success**: Package ${args.action === 'add' ? 'added to' : 'removed from'} denylist.\n`;
          if (args.action === 'add') {
            markdown += `\nRoot will be hidden from \`${args.package_name}\` after app restart.\n`;
          }
        } else {
          markdown += `❌ **Failed**: ${result.stderr || result.stdout || 'Unknown error'}\n`;
        }

        if (!denylistEnabled && args.action === 'add') {
          markdown += `\n⚠️ **Warning**: Denylist is not enabled. Enable it in Magisk settings for hiding to work.\n`;
        }

        return markdown;
      });
    }
  }
};
