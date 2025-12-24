/**
 * Play Integrity Fix (PIF) management tools
 * Supports PlayIntegrityFix, TrickyStore, and related Magisk modules
 */

import { z } from 'zod';
import { CommandExecutor } from '../utils/executor.js';
import { DeviceManager } from '../utils/device-manager.js';
import { ErrorHandler } from '../utils/error-handler.js';

// PIF module paths
const PIF_PATHS = {
  playIntegrityFix: {
    custom: '/data/adb/modules/playintegrityfix/custom.pif.json',
    customProp: '/data/adb/modules/playintegrityfix/custom.pif.prop',
    default: '/data/adb/modules/playintegrityfix/pif.json',
  },
  trickyStore: {
    spoof: '/data/adb/tricky_store/spoof_build_vars',
  },
  targetedFix: {
    base: '/data/adb/modules/targetedfix/',
  },
};

// Known PIF module IDs
const PIF_MODULE_IDS = [
  'playintegrityfix',
  'playcurl',
  'tricky_store',
  'trickystore',
  'targetedfix',
  'pif',
];

// Schemas
export const GetPifSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const SetPifSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  pif_json: z.string().describe('PIF JSON content or path to local JSON file'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const ListPifModulesSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const GetPifStatusSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

// PIF JSON keys we recognize
const KNOWN_PIF_KEYS = [
  'MANUFACTURER', 'MODEL', 'FINGERPRINT', 'BRAND', 'PRODUCT', 'DEVICE',
  'RELEASE', 'ID', 'INCREMENTAL', 'TYPE', 'TAGS', 'SECURITY_PATCH',
  'DEVICE_INITIAL_SDK_INT', 'BUILD_ID', 'VNDK_VERSION',
  'api_level', 'first_api_level', 'security_patch',
];

// Tool implementations
export const pifTools = {
  get_pif: {
    description: `Get the current PIF (Play Integrity Fix) configuration from device.

Retrieves the PIF JSON configuration from installed PIF module.
Supports PlayIntegrityFix, TrickyStore, and other PIF modules.

The PIF contains device fingerprint data used to pass Play Integrity checks.

Requires root access with a PIF module installed.

Examples:
- get_pif(device_id="RF8M33...")`,
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
    handler: async (args: z.infer<typeof GetPifSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        // Try to find PIF in order of preference
        const pifLocations = [
          { path: PIF_PATHS.playIntegrityFix.custom, name: 'PlayIntegrityFix (custom)', format: 'json' },
          { path: PIF_PATHS.playIntegrityFix.customProp, name: 'PlayIntegrityFix (custom prop)', format: 'prop' },
          { path: PIF_PATHS.playIntegrityFix.default, name: 'PlayIntegrityFix (default)', format: 'json' },
          { path: PIF_PATHS.trickyStore.spoof, name: 'TrickyStore', format: 'prop' },
        ];

        let pifContent: string | null = null;
        let pifSource: string | null = null;
        let pifFormat: string | null = null;
        let pifPath: string | null = null;

        for (const loc of pifLocations) {
          const result = await CommandExecutor.shell(
            args.device_id,
            `su -c "cat '${loc.path}' 2>/dev/null" || echo ""`
          );

          if (result.success && result.stdout.trim() && !result.stdout.includes('No such file')) {
            pifContent = result.stdout.trim();
            pifSource = loc.name;
            pifFormat = loc.format;
            pifPath = loc.path;
            break;
          }
        }

        if (!pifContent) {
          if (args.format === 'json') {
            return JSON.stringify({
              found: false,
              error: 'No PIF configuration found',
              checked_paths: pifLocations.map(l => l.path),
            }, null, 2);
          }
          return `# PIF Not Found\n\n` +
            `No PIF configuration found on device.\n\n` +
            `**Checked locations**:\n` +
            pifLocations.map(l => `- ${l.path}`).join('\n') +
            `\n\n**Tip**: Install PlayIntegrityFix or TrickyStore module first.`;
        }

        // Parse PIF content
        let pifData: Record<string, unknown> = {};

        if (pifFormat === 'json') {
          try {
            pifData = JSON.parse(pifContent);
          } catch {
            pifData = { raw: pifContent, parseError: 'Invalid JSON' };
          }
        } else if (pifFormat === 'prop') {
          // Parse property format (key=value)
          const lines = pifContent.split('\n');
          for (const line of lines) {
            const match = line.match(/^([^=]+)=(.*)$/);
            if (match) {
              pifData[match[1].trim()] = match[2].trim();
            }
          }
        }

        if (args.format === 'json') {
          return JSON.stringify({
            found: true,
            source: pifSource,
            path: pifPath,
            format: pifFormat,
            content: pifData,
          }, null, 2);
        }

        let markdown = `# PIF Configuration\n\n`;
        markdown += `**Source**: ${pifSource}\n`;
        markdown += `**Path**: ${pifPath}\n`;
        markdown += `**Format**: ${pifFormat}\n\n`;
        markdown += `## Properties\n\n`;
        markdown += `| Key | Value |\n`;
        markdown += `|-----|-------|\n`;

        for (const [key, value] of Object.entries(pifData)) {
          const displayValue = typeof value === 'string'
            ? (value.length > 50 ? value.substring(0, 47) + '...' : value)
            : JSON.stringify(value);
          markdown += `| ${key} | ${displayValue} |\n`;
        }

        return markdown;
      });
    }
  },

  set_pif: {
    description: `Set/push a PIF configuration to device.

Pushes a PIF JSON configuration to the device's PIF module.
Will validate JSON format before pushing.

After pushing, Google Play Services is killed to apply changes.

Requires root access with PlayIntegrityFix module installed.

Examples:
- set_pif(device_id="RF8M33...", pif_json='{"MANUFACTURER":"Google",...}')`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        pif_json: {
          type: 'string' as const,
          description: 'PIF JSON content or path to local JSON file'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id', 'pif_json']
    },
    handler: async (args: z.infer<typeof SetPifSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        // Parse and validate PIF JSON
        let pifData: Record<string, unknown>;
        let pifSource = 'inline';

        // Check if it's a file path
        if (args.pif_json.endsWith('.json') && !args.pif_json.startsWith('{')) {
          const fs = await import('fs');
          if (fs.existsSync(args.pif_json)) {
            const content = fs.readFileSync(args.pif_json, 'utf-8');
            pifData = JSON.parse(content);
            pifSource = args.pif_json;
          } else {
            throw new Error(`PIF file not found: ${args.pif_json}`);
          }
        } else {
          try {
            pifData = JSON.parse(args.pif_json);
          } catch {
            throw new Error('Invalid PIF JSON format');
          }
        }

        // Basic validation
        if (typeof pifData !== 'object' || pifData === null) {
          throw new Error('PIF must be a JSON object');
        }

        // Check for some expected keys
        const hasExpectedKeys = Object.keys(pifData).some(key =>
          KNOWN_PIF_KEYS.includes(key) || key.startsWith('ro.')
        );

        if (!hasExpectedKeys) {
          throw new Error('PIF JSON does not contain expected properties (MANUFACTURER, MODEL, FINGERPRINT, etc.)');
        }

        // Check if PlayIntegrityFix module exists
        const moduleCheck = await CommandExecutor.shell(
          args.device_id,
          `su -c "test -d /data/adb/modules/playintegrityfix && echo yes || echo no"`
        );

        if (!moduleCheck.success || moduleCheck.stdout.trim() !== 'yes') {
          throw new Error('PlayIntegrityFix module not found. Install it first.');
        }

        // Format JSON nicely
        const formattedJson = JSON.stringify(pifData, null, 2);

        // Write to temp file on device, then move to target
        const tempPath = '/data/local/tmp/pif_temp.json';
        const targetPath = PIF_PATHS.playIntegrityFix.custom;

        // Write via echo (escape for shell)
        const escapedJson = formattedJson.replace(/'/g, "'\\''");
        const writeResult = await CommandExecutor.shell(
          args.device_id,
          `su -c "echo '${escapedJson}' > '${tempPath}' && mv '${tempPath}' '${targetPath}' && chmod 644 '${targetPath}'"`
        );

        if (!writeResult.success) {
          throw new Error(`Failed to write PIF: ${writeResult.stderr}`);
        }

        // Verify write
        const verifyResult = await CommandExecutor.shell(
          args.device_id,
          `su -c "cat '${targetPath}'" 2>/dev/null`
        );

        if (!verifyResult.success || !verifyResult.stdout.includes('{')) {
          throw new Error('PIF write verification failed');
        }

        // Kill Google Play Services to apply
        await CommandExecutor.shell(
          args.device_id,
          `su -c "killall com.google.android.gms.unstable 2>/dev/null; killall com.android.vending 2>/dev/null"`
        );

        const keyCount = Object.keys(pifData).length;

        if (args.format === 'json') {
          return JSON.stringify({
            success: true,
            source: pifSource,
            target_path: targetPath,
            properties: keyCount,
            gms_killed: true,
          }, null, 2);
        }

        let markdown = `# PIF Updated\n\n`;
        markdown += `**Status**: ✅ Success\n`;
        markdown += `**Source**: ${pifSource}\n`;
        markdown += `**Target**: ${targetPath}\n`;
        markdown += `**Properties**: ${keyCount}\n\n`;
        markdown += `Google Play Services has been killed to apply changes.\n\n`;
        markdown += `**Tip**: Run a Play Integrity check to verify the fingerprint works.`;

        return markdown;
      });
    }
  },

  list_pif_modules: {
    description: `List installed PIF-related Magisk modules.

Detects installed modules related to Play Integrity bypass:
- PlayIntegrityFix
- TrickyStore
- TargetedFix
- Other PIF variants

Shows module status (enabled/disabled) and version.

Requires root access.

Examples:
- list_pif_modules(device_id="RF8M33...")`,
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
    handler: async (args: z.infer<typeof ListPifModulesSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        // List all modules
        const listResult = await CommandExecutor.shell(
          args.device_id,
          `su -c "ls -1 /data/adb/modules 2>/dev/null" || echo ""`
        );

        if (!listResult.success || !listResult.stdout.trim()) {
          if (args.format === 'json') {
            return JSON.stringify({
              found: false,
              modules: [],
              error: 'No Magisk modules directory found or empty',
            }, null, 2);
          }
          return `# PIF Modules\n\nNo Magisk modules found. Is the device rooted with Magisk?`;
        }

        const allModules = listResult.stdout.trim().split('\n').filter(m => m);

        interface PifModuleInfo {
          id: string;
          name: string;
          version: string;
          enabled: boolean;
          pifRelated: boolean;
        }

        const pifModules: PifModuleInfo[] = [];

        for (const moduleId of allModules) {
          // Check if it's a PIF-related module
          const isPifRelated = PIF_MODULE_IDS.some(id =>
            moduleId.toLowerCase().includes(id) ||
            id.includes(moduleId.toLowerCase())
          );

          if (!isPifRelated) continue;

          // Read module.prop
          const propResult = await CommandExecutor.shell(
            args.device_id,
            `su -c "cat '/data/adb/modules/${moduleId}/module.prop' 2>/dev/null" || echo ""`
          );

          const props: Record<string, string> = {};
          if (propResult.success && propResult.stdout.trim()) {
            for (const line of propResult.stdout.split('\n')) {
              const match = line.match(/^([^=]+)=(.*)$/);
              if (match) {
                props[match[1].trim()] = match[2].trim();
              }
            }
          }

          // Check if disabled
          const disableCheck = await CommandExecutor.shell(
            args.device_id,
            `su -c "test -f '/data/adb/modules/${moduleId}/disable' && echo yes || echo no"`
          );

          pifModules.push({
            id: moduleId,
            name: props.name || moduleId,
            version: props.version || 'unknown',
            enabled: disableCheck.stdout.trim() !== 'yes',
            pifRelated: true,
          });
        }

        if (args.format === 'json') {
          return JSON.stringify({
            found: pifModules.length > 0,
            modules: pifModules,
            total: pifModules.length,
          }, null, 2);
        }

        let markdown = `# PIF Modules\n\n`;

        if (pifModules.length === 0) {
          markdown += `No PIF-related modules found.\n\n`;
          markdown += `**Tip**: Install PlayIntegrityFix or TrickyStore for Play Integrity bypass.`;
          return markdown;
        }

        markdown += `| Module | Version | Status |\n`;
        markdown += `|--------|---------|--------|\n`;

        for (const mod of pifModules) {
          const status = mod.enabled ? '✅ Enabled' : '⏸️ Disabled';
          markdown += `| ${mod.name} | ${mod.version} | ${status} |\n`;
        }

        return markdown;
      });
    }
  },

  get_pif_status: {
    description: `Get comprehensive PIF status on device.

Shows:
- Installed PIF modules and their status
- Active PIF configuration path
- PIF format (JSON or property)
- Key fingerprint properties
- Magisk version

Useful for diagnosing Play Integrity issues.

Requires root access.

Examples:
- get_pif_status(device_id="RF8M33...")`,
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
    handler: async (args: z.infer<typeof GetPifStatusSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        // Get Magisk version
        const magiskResult = await CommandExecutor.shell(
          args.device_id,
          `su -c "magisk -v 2>/dev/null" || echo "not_found"`
        );
        const magiskVersion = magiskResult.stdout.trim();

        // Check each PIF path
        interface PathStatus {
          path: string;
          exists: boolean;
          format: string;
          size?: number;
        }

        const pathStatuses: PathStatus[] = [];
        const allPaths = [
          { path: PIF_PATHS.playIntegrityFix.custom, format: 'json' },
          { path: PIF_PATHS.playIntegrityFix.customProp, format: 'prop' },
          { path: PIF_PATHS.playIntegrityFix.default, format: 'json' },
          { path: PIF_PATHS.trickyStore.spoof, format: 'prop' },
        ];

        for (const p of allPaths) {
          const check = await CommandExecutor.shell(
            args.device_id,
            `su -c "test -f '${p.path}' && stat -c%s '${p.path}' 2>/dev/null" || echo "no"`
          );

          if (check.success && check.stdout.trim() !== 'no') {
            pathStatuses.push({
              path: p.path,
              exists: true,
              format: p.format,
              size: parseInt(check.stdout.trim()) || 0,
            });
          } else {
            pathStatuses.push({
              path: p.path,
              exists: false,
              format: p.format,
            });
          }
        }

        // Get active PIF content (first existing)
        let activePif: Record<string, unknown> | null = null;
        let activePath: string | null = null;

        for (const status of pathStatuses) {
          if (status.exists) {
            const content = await CommandExecutor.shell(
              args.device_id,
              `su -c "cat '${status.path}'" 2>/dev/null`
            );

            if (content.success && content.stdout.trim()) {
              activePath = status.path;
              try {
                if (status.format === 'json') {
                  activePif = JSON.parse(content.stdout);
                } else {
                  activePif = {};
                  for (const line of content.stdout.split('\n')) {
                    const match = line.match(/^([^=]+)=(.*)$/);
                    if (match) {
                      activePif[match[1].trim()] = match[2].trim();
                    }
                  }
                }
              } catch {
                activePif = { raw: content.stdout.substring(0, 200) };
              }
              break;
            }
          }
        }

        // Get key fingerprint values
        const fingerprint = activePif?.FINGERPRINT || activePif?.['ro.build.fingerprint'] || 'N/A';
        const model = activePif?.MODEL || activePif?.['ro.product.model'] || 'N/A';
        const manufacturer = activePif?.MANUFACTURER || activePif?.['ro.product.manufacturer'] || 'N/A';

        if (args.format === 'json') {
          return JSON.stringify({
            magisk_version: magiskVersion,
            paths: pathStatuses,
            active_path: activePath,
            active_pif: activePif,
            fingerprint: String(fingerprint),
            model: String(model),
            manufacturer: String(manufacturer),
          }, null, 2);
        }

        let markdown = `# PIF Status\n\n`;
        markdown += `## System\n\n`;
        markdown += `**Magisk Version**: ${magiskVersion}\n\n`;

        markdown += `## PIF Paths\n\n`;
        markdown += `| Path | Status | Format |\n`;
        markdown += `|------|--------|--------|\n`;

        for (const status of pathStatuses) {
          const exists = status.exists ? `✅ (${status.size} bytes)` : '❌';
          markdown += `| ${status.path} | ${exists} | ${status.format} |\n`;
        }

        markdown += `\n## Active Configuration\n\n`;

        if (activePif) {
          markdown += `**Path**: ${activePath}\n\n`;
          markdown += `**Key Properties**:\n`;
          markdown += `- Manufacturer: ${manufacturer}\n`;
          markdown += `- Model: ${model}\n`;
          markdown += `- Fingerprint: ${String(fingerprint).substring(0, 60)}...\n`;
        } else {
          markdown += `No active PIF configuration found.\n`;
        }

        return markdown;
      });
    }
  }
};
