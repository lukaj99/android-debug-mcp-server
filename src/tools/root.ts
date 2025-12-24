/**
 * Root solution and module management tools
 * Supports Magisk, KernelSU, and APatch
 */

import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { CommandExecutor } from '../utils/executor.js';
import { DeviceManager } from '../utils/device-manager.js';
import { ErrorHandler } from '../utils/error-handler.js';
import { RootDetector } from '../utils/root-detector.js';

// Module directory paths for different root solutions
const MODULE_PATHS = {
  magisk: '/data/adb/modules',
  kernelsu: '/data/adb/ksu/modules',
  apatch: '/data/adb/apatch/modules',
};

// Module state file names
const MODULE_STATE_FILES = {
  disable: 'disable',
  remove: 'remove',
  update: 'update',
  skip_mount: 'skip_mount',
};

// Schemas
export const ListRootModulesSchema = z.object({
  device_id: z.string().describe('Device serial number'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const InstallRootModuleSchema = z.object({
  device_id: z.string().describe('Device serial number'),
  module_path: z.string().describe('Local path to module zip file'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const ManageRootModuleSchema = z.object({
  device_id: z.string().describe('Device serial number'),
  module_id: z.string().describe('Module ID (folder name)'),
  action: z.enum(['enable', 'disable', 'remove']).describe('Action to perform'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const GetDenylistSchema = z.object({
  device_id: z.string().describe('Device serial number'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

// Security constants
const MODULE_ID_REGEX = /^[a-zA-Z0-9_-]+$/;
const MAX_MODULE_SIZE = 500 * 1024 * 1024; // 500MB max module size

// Security: Validate module ID (alphanumeric, underscore, hyphen only)
function validateModuleId(moduleId: string): void {
  if (!MODULE_ID_REGEX.test(moduleId)) {
    throw new Error(`Invalid module ID: ${moduleId}. Must be alphanumeric with underscores/hyphens only.`);
  }
  if (moduleId.length > 64) {
    throw new Error(`Module ID too long: ${moduleId}. Maximum 64 characters.`);
  }
  // Prevent traversal
  if (moduleId === '.' || moduleId === '..') {
    throw new Error(`Invalid module ID: ${moduleId}`);
  }
}

function validateModulePath(modulePath: string): void {
  if (modulePath.includes('..') || modulePath.includes('\0')) {
    throw new Error(`Invalid module path: ${modulePath}`);
  }
  const resolved = path.resolve(modulePath);
  const blocked = ['/etc', '/proc', '/sys', '/dev', '/root', '/boot'];
  for (const b of blocked) {
    if (resolved.startsWith(b + '/') || resolved === b) {
      throw new Error(`Access to ${b} is not allowed`);
    }
  }
}

// Module info interface
interface ModuleInfo {
  id: string;
  name: string;
  version: string;
  versionCode: number;
  author: string;
  description: string;
  enabled: boolean;
  pendingRemove: boolean;
  pendingUpdate: boolean;
  skipMount: boolean;
  rootSolution: string;
}

// Parse module.prop file content
function parseModuleProp(content: string): Partial<ModuleInfo> {
  const props: Record<string, string> = {};
  for (const line of content.split('\n')) {
    const match = line.match(/^([^=]+)=(.*)$/);
    if (match) {
      props[match[1].trim()] = match[2].trim();
    }
  }
  return {
    id: props.id || '',
    name: props.name || props.id || '',
    version: props.version || '',
    versionCode: parseInt(props.versionCode || '0', 10),
    author: props.author || '',
    description: props.description || '',
  };
}

// Tool implementations
export const rootTools = {
  list_root_modules: {
    description: `List installed root modules.

Lists all installed modules for the detected root solution (Magisk, KernelSU, or APatch).

Shows for each module:
- ID, name, version
- Author and description
- Status (enabled/disabled, pending remove)

Requires root access on device.

Examples:
- list_root_modules(device_id="RF8M33...")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device serial number'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof ListRootModulesSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        // Detect root solution
        const rootInfo = await RootDetector.getPrimaryRootSolution(args.device_id);
        if (!rootInfo) {
          throw new Error('No root solution detected on device');
        }

        // Determine module path based on root solution
        let modulePath = MODULE_PATHS.magisk; // Default
        if (rootInfo.solution.includes('kernelsu')) {
          modulePath = MODULE_PATHS.kernelsu;
        } else if (rootInfo.solution.includes('apatch')) {
          modulePath = MODULE_PATHS.apatch;
        }

        // List modules directory
        const listResult = await CommandExecutor.shell(
          args.device_id,
          `su -c "ls -1 '${modulePath}' 2>/dev/null" || echo ""`
        );

        if (!listResult.success || !listResult.stdout.trim()) {
          if (args.format === 'json') {
            return JSON.stringify({
              rootSolution: rootInfo.solution,
              modulePath,
              modules: [],
              count: 0,
            }, null, 2);
          }
          return `# Root Modules\n\n**Root Solution**: ${rootInfo.solution}\n**Module Path**: ${modulePath}\n\nNo modules installed.`;
        }

        // Parse each module
        const moduleIds = listResult.stdout.trim().split('\n').filter(id => id && id !== '.' && id !== '..');
        const modules: ModuleInfo[] = [];

        for (const moduleId of moduleIds) {
          // Skip hidden/system entries
          if (moduleId.startsWith('.')) continue;

          const moduleDir = `${modulePath}/${moduleId}`;

          // Read module.prop
          const propResult = await CommandExecutor.shell(
            args.device_id,
            `su -c "cat '${moduleDir}/module.prop' 2>/dev/null" || echo ""`
          );

          const moduleInfo: ModuleInfo = {
            id: moduleId,
            name: moduleId,
            version: '',
            versionCode: 0,
            author: '',
            description: '',
            enabled: true,
            pendingRemove: false,
            pendingUpdate: false,
            skipMount: false,
            rootSolution: rootInfo.solution,
          };

          if (propResult.success && propResult.stdout.trim()) {
            const parsed = parseModuleProp(propResult.stdout);
            Object.assign(moduleInfo, parsed);
          }

          // Check state files
          const checkState = async (stateFile: string): Promise<boolean> => {
            const result = await CommandExecutor.shell(
              args.device_id,
              `su -c "test -f '${moduleDir}/${stateFile}' && echo yes || echo no"`
            );
            return result.success && result.stdout.trim() === 'yes';
          };

          moduleInfo.enabled = !(await checkState(MODULE_STATE_FILES.disable));
          moduleInfo.pendingRemove = await checkState(MODULE_STATE_FILES.remove);
          moduleInfo.pendingUpdate = await checkState(MODULE_STATE_FILES.update);
          moduleInfo.skipMount = await checkState(MODULE_STATE_FILES.skip_mount);

          modules.push(moduleInfo);
        }

        if (args.format === 'json') {
          return JSON.stringify({
            rootSolution: rootInfo.solution,
            rootVersion: rootInfo.version || rootInfo.appVersion,
            modulePath,
            modules,
            count: modules.length,
          }, null, 2);
        }

        let markdown = `# Root Modules\n\n`;
        markdown += `**Root Solution**: ${rootInfo.solution}`;
        if (rootInfo.version || rootInfo.appVersion) {
          markdown += ` v${rootInfo.version || rootInfo.appVersion}`;
        }
        markdown += `\n`;
        markdown += `**Module Path**: ${modulePath}\n`;
        markdown += `**Total Modules**: ${modules.length}\n\n`;

        if (modules.length === 0) {
          markdown += `No modules installed.\n`;
          return markdown;
        }

        markdown += `| Module | Version | Status | Author |\n`;
        markdown += `|--------|---------|--------|--------|\n`;

        for (const mod of modules) {
          let status = mod.enabled ? '✅ Enabled' : '⏸️ Disabled';
          if (mod.pendingRemove) status = '🗑️ Pending Remove';
          if (mod.pendingUpdate) status += ' (Update)';

          markdown += `| ${mod.name} | ${mod.version || 'N/A'} | ${status} | ${mod.author || 'Unknown'} |\n`;
        }

        // Add details for each module
        markdown += `\n## Module Details\n\n`;
        for (const mod of modules) {
          markdown += `### ${mod.name}\n\n`;
          markdown += `- **ID**: ${mod.id}\n`;
          markdown += `- **Version**: ${mod.version || 'N/A'} (${mod.versionCode})\n`;
          markdown += `- **Author**: ${mod.author || 'Unknown'}\n`;
          if (mod.description) {
            markdown += `- **Description**: ${mod.description}\n`;
          }
          markdown += `\n`;
        }

        return markdown;
      });
    }
  },

  install_root_module: {
    description: `Install a root module from zip file.

Installs a module zip to the device's root solution (Magisk, KernelSU, or APatch).

Process:
1. Detects active root solution
2. Pushes module zip to device
3. Extracts to modules directory
4. Reboot required to activate

Requires root access on device.

Examples:
- install_root_module(device_id="RF8M33...", module_path="/downloads/lsposed.zip")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device serial number'
        },
        module_path: {
          type: 'string' as const,
          description: 'Local path to module zip file'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id', 'module_path']
    },
    handler: async (args: z.infer<typeof InstallRootModuleSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        validateModulePath(args.module_path);

        if (!fs.existsSync(args.module_path)) {
          throw new Error(`Module file not found: ${args.module_path}`);
        }

        // Validate file size before upload
        const stats = fs.statSync(args.module_path);
        if (stats.size > MAX_MODULE_SIZE) {
          throw new Error(`Module file too large: ${Math.round(stats.size / 1024 / 1024)}MB (max ${MAX_MODULE_SIZE / 1024 / 1024}MB)`);
        }
        if (stats.size < 100) {
          throw new Error('Module file too small to be valid');
        }

        // Validate it's a zip file
        const fd = fs.openSync(args.module_path, 'r');
        const header = Buffer.alloc(4);
        fs.readSync(fd, header, 0, 4, 0);
        fs.closeSync(fd);
        if (!header.equals(Buffer.from([0x50, 0x4B, 0x03, 0x04]))) {
          throw new Error('Not a valid ZIP file');
        }

        // Detect root solution
        const rootInfo = await RootDetector.getPrimaryRootSolution(args.device_id);
        if (!rootInfo) {
          throw new Error('No root solution detected on device');
        }

        // Determine module path
        let modulesDir = MODULE_PATHS.magisk;
        if (rootInfo.solution.includes('kernelsu')) {
          modulesDir = MODULE_PATHS.kernelsu;
        } else if (rootInfo.solution.includes('apatch')) {
          modulesDir = MODULE_PATHS.apatch;
        }

        // Sanitize filename for temp path (alphanumeric, underscore, hyphen, dot only)
        const rawFilename = path.basename(args.module_path);
        const safeFilename = rawFilename.replace(/[^a-zA-Z0-9._-]/g, '_');
        if (!safeFilename || safeFilename.length > 128) {
          throw new Error('Invalid filename');
        }
        const deviceTempPath = `/data/local/tmp/${safeFilename}`;

        // Push module to device
        const pushResult = await CommandExecutor.adb(args.device_id, ['push', args.module_path, deviceTempPath]);
        if (!pushResult.success) {
          throw new Error(`Failed to push module: ${pushResult.stderr}`);
        }

        // Cleanup helper - ensures temp file is removed
        const cleanupTemp = async () => {
          await CommandExecutor.shell(args.device_id, `rm -f '${deviceTempPath}'`);
        };

        try {
          // Extract module ID from zip (read module.prop)
          const extractIdResult = await CommandExecutor.shell(
            args.device_id,
            `su -c "unzip -p '${deviceTempPath}' module.prop 2>/dev/null | grep '^id=' | cut -d= -f2"`
          );

          let moduleId = extractIdResult.stdout.trim();
          if (!moduleId) {
            // Fallback: use filename without extension
            moduleId = path.basename(safeFilename, '.zip').replace(/[^a-zA-Z0-9_-]/g, '_');
          }

          validateModuleId(moduleId);

          const moduleDir = `${modulesDir}/${moduleId}`;

          // Create module directory and extract
          const installResult = await CommandExecutor.shell(
            args.device_id,
            `su -c "mkdir -p '${moduleDir}' && unzip -o '${deviceTempPath}' -d '${moduleDir}' && chmod -R 755 '${moduleDir}'"`
          );

          if (!installResult.success) {
            // Cleanup partial installation
            await CommandExecutor.shell(args.device_id, `su -c "rm -rf '${moduleDir}'"`);
            throw new Error(`Failed to install module: ${installResult.stderr}`);
          }

          // Read installed module info
          const propResult = await CommandExecutor.shell(
            args.device_id,
            `su -c "cat '${moduleDir}/module.prop' 2>/dev/null" || echo ""`
          );

          const moduleInfo = parseModuleProp(propResult.stdout);

          if (args.format === 'json') {
            return JSON.stringify({
              success: true,
              rootSolution: rootInfo.solution,
              moduleId,
              moduleName: moduleInfo.name || moduleId,
              version: moduleInfo.version,
              installPath: moduleDir,
              rebootRequired: true,
            }, null, 2);
          }

          let markdown = `# Module Installed\n\n`;
          markdown += `**Status**: ✅ Success\n\n`;
          markdown += `## Module Info\n\n`;
          markdown += `- **ID**: ${moduleId}\n`;
          markdown += `- **Name**: ${moduleInfo.name || moduleId}\n`;
          markdown += `- **Version**: ${moduleInfo.version || 'N/A'}\n`;
          markdown += `- **Author**: ${moduleInfo.author || 'Unknown'}\n`;
          markdown += `- **Install Path**: ${moduleDir}\n\n`;
          markdown += `## Root Solution\n\n`;
          markdown += `- **Type**: ${rootInfo.solution}\n`;
          markdown += `- **Version**: ${rootInfo.version || rootInfo.appVersion || 'Unknown'}\n\n`;
          markdown += `⚠️ **Reboot required** to activate the module.\n`;

          return markdown;
        } finally {
          // Always cleanup temp file
          await cleanupTemp();
        }
      });
    }
  },

  manage_root_module: {
    description: `Enable, disable, or remove a root module.

Actions:
- enable: Removes 'disable' flag, module will be active after reboot
- disable: Creates 'disable' flag, module will be inactive after reboot
- remove: Marks module for removal on next reboot

Changes take effect after device reboot.

Requires root access on device.

Examples:
- manage_root_module(device_id="RF8M33...", module_id="lsposed", action="disable")
- manage_root_module(device_id="RF8M33...", module_id="shamiko", action="remove")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device serial number'
        },
        module_id: {
          type: 'string' as const,
          description: 'Module ID (folder name)'
        },
        action: {
          type: 'string' as const,
          enum: ['enable', 'disable', 'remove'],
          description: 'Action to perform'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id', 'module_id', 'action']
    },
    handler: async (args: z.infer<typeof ManageRootModuleSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        validateModuleId(args.module_id);

        // Detect root solution
        const rootInfo = await RootDetector.getPrimaryRootSolution(args.device_id);
        if (!rootInfo) {
          throw new Error('No root solution detected on device');
        }

        // Determine module path
        let modulesDir = MODULE_PATHS.magisk;
        if (rootInfo.solution.includes('kernelsu')) {
          modulesDir = MODULE_PATHS.kernelsu;
        } else if (rootInfo.solution.includes('apatch')) {
          modulesDir = MODULE_PATHS.apatch;
        }

        const moduleDir = `${modulesDir}/${args.module_id}`;

        // Check if module exists
        const existsResult = await CommandExecutor.shell(
          args.device_id,
          `su -c "test -d '${moduleDir}' && echo yes || echo no"`
        );

        if (existsResult.stdout.trim() !== 'yes') {
          throw new Error(`Module not found: ${args.module_id}`);
        }

        let actionResult;
        let statusMessage = '';

        switch (args.action) {
          case 'enable':
            // Remove disable flag
            actionResult = await CommandExecutor.shell(
              args.device_id,
              `su -c "rm -f '${moduleDir}/${MODULE_STATE_FILES.disable}'"`
            );
            statusMessage = 'Module will be enabled after reboot';
            break;

          case 'disable':
            // Create disable flag
            actionResult = await CommandExecutor.shell(
              args.device_id,
              `su -c "touch '${moduleDir}/${MODULE_STATE_FILES.disable}'"`
            );
            statusMessage = 'Module will be disabled after reboot';
            break;

          case 'remove':
            // Create remove flag (module removed on next boot)
            actionResult = await CommandExecutor.shell(
              args.device_id,
              `su -c "touch '${moduleDir}/${MODULE_STATE_FILES.remove}'"`
            );
            statusMessage = 'Module marked for removal on next reboot';
            break;
        }

        if (!actionResult.success) {
          throw new Error(`Failed to ${args.action} module: ${actionResult.stderr}`);
        }

        // Get current module info
        const propResult = await CommandExecutor.shell(
          args.device_id,
          `su -c "cat '${moduleDir}/module.prop' 2>/dev/null" || echo ""`
        );
        const moduleInfo = parseModuleProp(propResult.stdout);

        if (args.format === 'json') {
          return JSON.stringify({
            success: true,
            moduleId: args.module_id,
            moduleName: moduleInfo.name || args.module_id,
            action: args.action,
            status: statusMessage,
            rebootRequired: true,
          }, null, 2);
        }

        let markdown = `# Module Action: ${args.action.toUpperCase()}\n\n`;
        markdown += `**Status**: ✅ Success\n\n`;
        markdown += `## Module\n\n`;
        markdown += `- **ID**: ${args.module_id}\n`;
        markdown += `- **Name**: ${moduleInfo.name || args.module_id}\n`;
        markdown += `- **Action**: ${args.action}\n\n`;
        markdown += `## Result\n\n`;
        markdown += `${statusMessage}\n\n`;
        markdown += `⚠️ **Reboot required** for changes to take effect.\n`;

        return markdown;
      });
    }
  },

  get_denylist: {
    description: `Get Magisk denylist entries.

Shows apps hidden from root detection (Magisk Hide / DenyList).

Features:
- Lists all packages in the denylist
- Shows denylist status (enabled/disabled)
- Works with Magisk and Magisk Delta

Note: KernelSU and APatch use different hiding mechanisms.

Requires root access with Magisk installed.

Examples:
- get_denylist(device_id="RF8M33...")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device serial number'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof GetDenylistSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        // Detect root solution
        const rootInfo = await RootDetector.getPrimaryRootSolution(args.device_id);
        if (!rootInfo) {
          throw new Error('No root solution detected on device');
        }

        // Check if Magisk
        if (!rootInfo.solution.includes('magisk')) {
          if (args.format === 'json') {
            return JSON.stringify({
              error: 'Denylist is a Magisk feature',
              rootSolution: rootInfo.solution,
              suggestion: rootInfo.solution.includes('kernelsu')
                ? 'KernelSU uses App Profile for hiding'
                : rootInfo.solution.includes('apatch')
                ? 'APatch uses its own hiding mechanism'
                : 'Unknown root solution',
            }, null, 2);
          }
          return `# Denylist\n\n**Error**: Denylist is a Magisk-specific feature.\n\n` +
            `Detected root solution: ${rootInfo.solution}\n\n` +
            (rootInfo.solution.includes('kernelsu')
              ? 'KernelSU uses App Profile for root hiding.\n'
              : rootInfo.solution.includes('apatch')
              ? 'APatch has its own hiding mechanism.\n'
              : '');
        }

        // Check denylist status
        const statusResult = await CommandExecutor.shell(
          args.device_id,
          'su -c "magisk --denylist status" 2>/dev/null'
        );

        const denylistEnabled = statusResult.success &&
          (statusResult.stdout.includes('enabled') || statusResult.stdout.includes('enforced'));

        // Get denylist entries
        const listResult = await CommandExecutor.shell(
          args.device_id,
          'su -c "magisk --denylist ls" 2>/dev/null || su -c "magisk --hide ls" 2>/dev/null || echo ""'
        );

        interface DenylistEntry {
          package: string;
          processes: string[];
        }

        const entries: DenylistEntry[] = [];

        if (listResult.success && listResult.stdout.trim()) {
          // Parse denylist output (format: package|process or just package)
          const lines = listResult.stdout.trim().split('\n');
          const packageMap = new Map<string, string[]>();

          for (const line of lines) {
            if (!line.trim()) continue;

            if (line.includes('|')) {
              const [pkg, process] = line.split('|');
              const existing = packageMap.get(pkg) || [];
              existing.push(process);
              packageMap.set(pkg, existing);
            } else {
              if (!packageMap.has(line)) {
                packageMap.set(line, []);
              }
            }
          }

          for (const [pkg, processes] of packageMap) {
            entries.push({ package: pkg, processes });
          }
        }

        if (args.format === 'json') {
          return JSON.stringify({
            rootSolution: rootInfo.solution,
            rootVersion: rootInfo.version || rootInfo.appVersion,
            denylistEnabled,
            entries,
            count: entries.length,
          }, null, 2);
        }

        let markdown = `# Magisk Denylist\n\n`;
        markdown += `**Root Solution**: ${rootInfo.solution}`;
        if (rootInfo.version || rootInfo.appVersion) {
          markdown += ` v${rootInfo.version || rootInfo.appVersion}`;
        }
        markdown += `\n`;
        markdown += `**Denylist Status**: ${denylistEnabled ? '✅ Enabled' : '❌ Disabled'}\n`;
        markdown += `**Entries**: ${entries.length}\n\n`;

        if (!denylistEnabled) {
          markdown += `⚠️ Denylist is disabled. Enable it in Magisk settings to hide root.\n\n`;
        }

        if (entries.length === 0) {
          markdown += `No packages in denylist.\n\n`;
          markdown += `Use Magisk app to add apps to the denylist.\n`;
          return markdown;
        }

        markdown += `## Hidden Packages\n\n`;
        markdown += `| Package | Processes |\n`;
        markdown += `|---------|----------|\n`;

        for (const entry of entries) {
          const processes = entry.processes.length > 0
            ? entry.processes.join(', ')
            : 'All';
          markdown += `| ${entry.package} | ${processes} |\n`;
        }

        return markdown;
      });
    }
  }
};
