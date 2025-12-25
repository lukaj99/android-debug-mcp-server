/**
 * Device management tools
 */

import { z } from 'zod';
import { DeviceManager } from '../utils/device-manager.js';
import { CommandExecutor } from '../utils/executor.js';
import { ResponseFormatter } from '../utils/formatter.js';
import { ErrorHandler } from '../utils/error-handler.js';
import { PlatformToolsManager } from '../utils/platform-tools-manager.js';
import { AVBParser } from '../utils/avb-parser.js';
import { RootDetector } from '../utils/root-detector.js';
import type { DeviceInfo, RebootMode, BootloaderState } from '../types.js';

// Schemas
export const ListDevicesSchema = z.object({
  format: z.enum(['markdown', 'json']).default('markdown'),
  detail: z.enum(['concise', 'detailed']).default('concise')
}).strict();

export const GetDeviceInfoSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown'),
  detail: z.enum(['concise', 'detailed']).default('concise')
}).strict();

export const RebootDeviceSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  mode: z.enum(['system', 'bootloader', 'recovery', 'fastboot', 'fastbootd', 'sideload']).default('system')
}).strict();

export const ConnectWirelessSchema = z.object({
  device_id: z.string().describe('Device ID currently connected via USB'),
  ip_address: z.string().optional().describe('IP address of device (optional, will detect if not provided)'),
  port: z.number().default(5555).describe('Port number for wireless ADB')
}).strict();

export const GetDeviceLogsSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  filter: z.string().optional().describe('Logcat filter expression (e.g., "E" for errors, "*:W" for warnings and above)'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const CheckDeviceHealthSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const SetupPlatformToolsSchema = z.object({
  force: z.boolean().default(false).describe('Force re-download even if already installed'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

// New Phase 1 Schemas
export const GetAVBStateSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const GetBootloaderStateSchema = z.object({
  device_id: z.string().describe('Device ID in fastboot mode'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const DetectRootSolutionSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const GetSlotInfoSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

// Phase 6A: WiFi ADB Schemas
export const PairDeviceSchema = z.object({
  ip_address: z.string().describe('IP address of the device'),
  port: z.number().describe('Pairing port shown on device'),
  pairing_code: z.string().describe('6-digit pairing code from device'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const ConnectWirelessNewSchema = z.object({
  ip_address: z.string().describe('IP address of the device'),
  port: z.number().default(5555).describe('Port number for wireless ADB'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const DisconnectWirelessSchema = z.object({
  ip_address: z.string().describe('IP address of the device to disconnect'),
  port: z.number().default(5555).describe('Port number'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const GetDeviceIpSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

// Tool implementations
export const deviceTools = {
  list_devices: {
    description: `List all connected Android devices.

Shows devices in all modes: ADB (device/unauthorized/offline), Fastboot (bootloader), recovery, and sideload.
Returns device ID, connection mode, model, and status.

Examples:
- list_devices() → See all connected devices
- list_devices(format="json") → Get structured data`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown',
          description: 'Output format'
        },
        detail: {
          type: 'string' as const,
          enum: ['concise', 'detailed'],
          default: 'concise',
          description: 'Detail level'
        }
      }
    },
    handler: async (args: z.infer<typeof ListDevicesSchema>) => {
      return ErrorHandler.wrap(async () => {
        const devices = await DeviceManager.listDevices(true);

        if (devices.length === 0) {
          return 'No Android devices found. Ensure USB debugging is enabled and device is connected.';
        }

        return ResponseFormatter.format(devices, args.format, args.detail);
      });
    }
  },

  get_device_info: {
    description: `Get detailed information about a specific device.

Returns comprehensive device details including:
- Hardware: manufacturer, model, serial number
- Software: Android version, SDK level, build ID
- Status: root access, bootloader state, battery level
- Network: IP address, wireless ADB status

Examples:
- get_device_info(device_id="ABC123") → Full device details
- get_device_info(device_id="ABC123", detail="detailed") → All available fields`,
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
    handler: async (args: z.infer<typeof GetDeviceInfoSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        const info: Partial<DeviceInfo> = {
          id: args.device_id,
          mode: 'device'
        };

        // Get device properties
        const props = await CommandExecutor.shell(args.device_id, 'getprop');

        if (props.success) {
          const lines = props.stdout.split('\n');
          for (const line of lines) {
            const match = line.match(/\[(.*?)\]: \[(.*?)\]/);
            if (match) {
              const [, key, value] = match;
              if (key === 'ro.product.manufacturer') info.manufacturer = value;
              if (key === 'ro.product.model') info.model = value;
              if (key === 'ro.build.version.release') info.androidVersion = value;
              if (key === 'ro.build.version.sdk') info.sdkVersion = value;
              if (key === 'ro.build.id') info.buildId = value;
              if (key === 'ro.serialno') info.serialNumber = value;
            }
          }
        }

        // Check root
        const suCheck = await CommandExecutor.shell(args.device_id, 'su -c id');
        info.isRooted = suCheck.success && suCheck.stdout.includes('uid=0');

        // Get bootloader status (requires root)
        if (info.isRooted) {
          const bootloaderCheck = await CommandExecutor.shell(args.device_id, 'su -c "getprop ro.boot.verifiedbootstate"');
          info.bootloaderUnlocked = bootloaderCheck.stdout === 'orange';
        } else {
          info.bootloaderUnlocked = false;
        }

        // Get battery info
        const battery = await CommandExecutor.shell(args.device_id, 'dumpsys battery');
        if (battery.success) {
          const levelMatch = battery.stdout.match(/level: (\d+)/);
          const statusMatch = battery.stdout.match(/status: (\d+)/);
          if (levelMatch) info.batteryLevel = parseInt(levelMatch[1], 10);
          if (statusMatch) {
            const statusCode = parseInt(statusMatch[1], 10);
            const statuses = ['Unknown', 'Charging', 'Discharging', 'Not charging', 'Full'];
            info.batteryStatus = statuses[statusCode] || 'Unknown';
          }
        }

        // Get IP address
        const ip = await CommandExecutor.shell(args.device_id, 'ip addr show wlan0');
        if (ip.success) {
          const ipMatch = ip.stdout.match(/inet (\d+\.\d+\.\d+\.\d+)/);
          if (ipMatch) info.ip = ipMatch[1];
        }

        // Check wireless ADB
        const adbWifi = await CommandExecutor.shell(args.device_id, 'getprop service.adb.tcp.port');
        info.adbWifi = adbWifi.success && adbWifi.stdout !== '-1' && adbWifi.stdout !== '';

        return ResponseFormatter.format(info, args.format, args.detail);
      });
    }
  },

  reboot_device: {
    description: `Reboot device to different modes.

Available modes:
- system: Normal reboot to Android
- bootloader: Reboot to fastboot/bootloader mode
- recovery: Reboot to recovery mode
- fastboot: Reboot to fastboot mode
- fastbootd: Reboot to fastbootd (userspace fastboot)
- sideload: Reboot to recovery sideload mode

Examples:
- reboot_device(device_id="ABC123") → Reboot normally
- reboot_device(device_id="ABC123", mode="bootloader") → Reboot to fastboot`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        mode: {
          type: 'string' as const,
          enum: ['system', 'bootloader', 'recovery', 'fastboot', 'fastbootd', 'sideload'],
          default: 'system',
          description: 'Target boot mode'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof RebootDeviceSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        const modeMap: Record<RebootMode, string> = {
          system: '',
          bootloader: 'bootloader',
          recovery: 'recovery',
          fastboot: 'bootloader',
          fastbootd: 'fastboot',
          sideload: 'sideload'
        };

        const rebootArg = modeMap[args.mode];
        const cmd = rebootArg ? ['reboot', rebootArg] : ['reboot'];

        const result = await CommandExecutor.adb(args.device_id, cmd);

        if (!result.success) {
          throw new Error(`Failed to reboot device: ${result.stderr}`);
        }

        DeviceManager.clearCache();

        return ResponseFormatter.success(
          `Device ${args.device_id} rebooting to ${args.mode} mode`,
          { note: 'Device will take 30-60 seconds to become available again' }
        );
      });
    }
  },

  connect_wireless: {
    description: `Enable and connect to device via wireless ADB.

This tool enables wireless ADB on a USB-connected device and connects to it wirelessly.
Device must initially be connected via USB. After successful connection, you can disconnect USB cable.

Steps performed:
1. Enable TCP/IP mode on device
2. Detect device IP address (if not provided)
3. Connect wirelessly

Examples:
- connect_wireless(device_id="ABC123") → Auto-detect IP and connect
- connect_wireless(device_id="ABC123", ip_address="192.168.1.100") → Connect to specific IP
- connect_wireless(device_id="ABC123", port=5556) → Use custom port`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID currently connected via USB'
        },
        ip_address: {
          type: 'string' as const,
          description: 'IP address of device (optional, will auto-detect)'
        },
        port: {
          type: 'number' as const,
          default: 5555,
          description: 'Port for wireless ADB'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof ConnectWirelessSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        // Enable TCP/IP mode
        const tcpip = await CommandExecutor.adb(args.device_id, ['tcpip', args.port.toString()]);
        if (!tcpip.success) {
          throw new Error(`Failed to enable wireless ADB: ${tcpip.stderr}`);
        }

        // Get IP address if not provided
        let ip = args.ip_address;
        if (!ip) {
          const ipResult = await CommandExecutor.shell(args.device_id, 'ip addr show wlan0');
          if (ipResult.success) {
            const match = ipResult.stdout.match(/inet (\d+\.\d+\.\d+\.\d+)/);
            if (match) {
              ip = match[1];
            }
          }
        }

        if (!ip) {
          throw new Error('Could not detect device IP address. Ensure device is connected to Wi-Fi, or provide ip_address parameter.');
        }

        // Wait a moment for TCP/IP mode to initialize
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Connect wirelessly
        const connect = await CommandExecutor.adb(null, ['connect', `${ip}:${args.port}`]);

        if (!connect.success || !connect.stdout.includes('connected')) {
          throw new Error(`Failed to connect wirelessly: ${connect.stderr || connect.stdout}`);
        }

        DeviceManager.clearCache();

        return ResponseFormatter.success(
          `Wireless ADB enabled and connected to ${ip}:${args.port}`,
          {
            note: 'You can now disconnect the USB cable. Use device ID format "192.168.1.100:5555" for wireless operations.',
            ip_address: ip,
            port: args.port
          }
        );
      });
    }
  },

  get_device_logs: {
    description: `Get device logs (logcat) with optional filtering.

Returns recent system logs from the device. Useful for debugging apps and system issues.

Filter examples:
- "*:E" → Only errors
- "*:W" → Warnings and above
- "ActivityManager:I *:S" → Only ActivityManager info logs
- "tag:priority" → Specific tag and priority

Priorities: V (Verbose), D (Debug), I (Info), W (Warning), E (Error), F (Fatal), S (Silent)

Examples:
- get_device_logs(device_id="ABC123") → All recent logs
- get_device_logs(device_id="ABC123", filter="*:E") → Only errors
- get_device_logs(device_id="ABC123", filter="ActivityManager:*") → Activity manager logs`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        filter: {
          type: 'string' as const,
          description: 'Logcat filter expression (e.g., "*:E" for errors)'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof GetDeviceLogsSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        const logs = await CommandExecutor.logcat(args.device_id, args.filter);

        if (args.format === 'json') {
          return JSON.stringify({ logs: logs.split('\n') }, null, 2);
        }

        return `# Device Logs: ${args.device_id}\n\n${args.filter ? `**Filter**: ${args.filter}\n\n` : ''}` +
               `\`\`\`\n${logs}\n\`\`\``;
      });
    }
  },

  check_device_health: {
    description: `Check device health and diagnostics.

Returns comprehensive health information:
- Battery: level, status, temperature, health
- Storage: internal/external space available
- Memory: RAM usage, available memory
- Temperature: battery and CPU temperature
- System: uptime, load average

Examples:
- check_device_health(device_id="ABC123") → Full health report
- check_device_health(device_id="ABC123", format="json") → Structured data`,
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
    handler: async (args: z.infer<typeof CheckDeviceHealthSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        const health: any = {};

        // Battery info
        const battery = await CommandExecutor.shell(args.device_id, 'dumpsys battery');
        if (battery.success) {
          const level = battery.stdout.match(/level: (\d+)/)?.[1];
          const temp = battery.stdout.match(/temperature: (\d+)/)?.[1];
          const status = battery.stdout.match(/status: (\d+)/)?.[1];
          const healthCode = battery.stdout.match(/health: (\d+)/)?.[1];

          const statusNames = ['Unknown', 'Charging', 'Discharging', 'Not charging', 'Full'];
          const healthNames = ['Unknown', 'Good', 'Overheat', 'Dead', 'Over voltage', 'Failure', 'Cold'];

          health.battery = {
            level: level ? `${level}%` : 'Unknown',
            temperature: temp ? `${parseInt(temp, 10) / 10}°C` : 'Unknown',
            status: statusNames[parseInt(status || '0', 10)] || 'Unknown',
            health: healthNames[parseInt(healthCode || '0', 10)] || 'Unknown'
          };
        }

        // Storage info
        const storage = await CommandExecutor.shell(args.device_id, 'df /data /sdcard');
        if (storage.success) {
          health.storage = parseStorageInfo(storage.stdout);
        }

        // Memory info
        const memory = await CommandExecutor.shell(args.device_id, 'cat /proc/meminfo');
        if (memory.success) {
          const totalMatch = memory.stdout.match(/MemTotal:\s+(\d+)/);
          const availMatch = memory.stdout.match(/MemAvailable:\s+(\d+)/);
          if (totalMatch && availMatch) {
            const total = parseInt(totalMatch[1], 10);
            const avail = parseInt(availMatch[1], 10);
            const used = total - avail;
            health.memory = {
              total: `${(total / 1024 / 1024).toFixed(1)} GB`,
              used: `${(used / 1024 / 1024).toFixed(1)} GB`,
              available: `${(avail / 1024 / 1024).toFixed(1)} GB`,
              usage_percent: `${((used / total) * 100).toFixed(1)}%`
            };
          }
        }

        // System uptime
        const uptime = await CommandExecutor.shell(args.device_id, 'uptime');
        if (uptime.success) {
          health.uptime = uptime.stdout.trim();
        }

        return ResponseFormatter.format(health, args.format, 'detailed');
      });
    }
  },

  setup_platform_tools: {
    description: `Download and install Android Platform Tools (ADB & Fastboot).

This tool automatically downloads the latest version of Android Platform Tools from Google
and installs them to ~/.android-debug-mcp/platform-tools/. The tools will be automatically
used by all other commands.

Platform-specific downloads:
- macOS: darwin.zip
- Linux: linux.zip  
- Windows: windows.zip

Examples:
- setup_platform_tools() → Install if not already present
- setup_platform_tools(force=true) → Re-download and reinstall`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        force: {
          type: 'boolean' as const,
          default: false,
          description: 'Force re-download even if already installed'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      }
    },
    handler: async (args: z.infer<typeof SetupPlatformToolsSchema>) => {
      return ErrorHandler.wrap(async () => {
        // Check current status
        const status = await PlatformToolsManager.getStatus();

        // If already installed and not forcing, return status
        if (status.installed && !args.force) {
          if (args.format === 'json') {
            return JSON.stringify(status, null, 2);
          }
          
          return `# Android Platform Tools - Already Installed ✓

**Installation Path**: ${status.path}
**ADB**: ${status.adbPath}
**Fastboot**: ${status.fastbootPath}

**Versions**:
- ADB: ${status.adbVersion}
- Fastboot: ${status.fastbootVersion}

Platform tools are already installed and ready to use. Use \`force=true\` to re-download.`;
        }

        // Download and install
        const result = await PlatformToolsManager.downloadAndInstall(args.force);
        
        // Get updated status
        const newStatus = await PlatformToolsManager.getStatus();

        if (args.format === 'json') {
          return JSON.stringify({
            success: true,
            message: result,
            ...newStatus
          }, null, 2);
        }

        return `# Android Platform Tools Setup Complete ✓

${result}

**Versions**:
- ADB: ${newStatus.adbVersion}
- Fastboot: ${newStatus.fastbootVersion}

All commands will now use these tools automatically.`;
      });
    }
  },

  get_avb_state: {
    description: `Get Android Verified Boot (AVB) state.

Returns comprehensive AVB/verity information:
- Bootloader lock state (locked/unlocked)
- Verity verification status
- Current slot information (A/B devices)
- Rollback protection indices
- Verified boot state (green/yellow/orange/red)

Works in both ADB and fastboot modes:
- ADB mode: Uses getprop queries (some info may require root)
- Fastboot mode: Uses getvar queries (full information)

AVB States:
- GREEN: Locked bootloader, verified stock firmware
- YELLOW: Locked bootloader, verified custom key
- ORANGE: Unlocked bootloader (verification disabled)
- RED: Verification failed

Examples:
- get_avb_state(device_id="ABC123") → Full AVB status
- get_avb_state(device_id="ABC123", format="json") → Structured data`,
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
    handler: async (args: z.infer<typeof GetAVBStateSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        const avbState = await AVBParser.getAVBState(args.device_id, device.mode);

        if (args.format === 'json') {
          return JSON.stringify(avbState, null, 2);
        }

        let result = `# AVB State: ${args.device_id}\n\n`;

        // Lock state
        const lockIcon = avbState.unlocked ? '🔓' : '🔒';
        result += `**Bootloader**: ${lockIcon} ${avbState.unlocked ? 'UNLOCKED' : 'LOCKED'}\n`;
        result += `**State**: ${avbState.stateDescription}\n\n`;

        // Verification status
        result += `## Verification Status\n\n`;
        result += `| Feature | Status |\n`;
        result += `|---------|--------|\n`;
        result += `| Verity | ${avbState.verityEnabled ? '✅ Enabled' : '❌ Disabled'} |\n`;
        result += `| Verification | ${avbState.verificationEnabled ? '✅ Enabled' : '❌ Disabled'} |\n`;

        // Slot info
        if (avbState.slotCount && avbState.slotCount >= 2) {
          result += `\n## A/B Slots\n\n`;
          result += `**Current Slot**: ${avbState.currentSlot || 'Unknown'}\n`;
          result += `**Slot Count**: ${avbState.slotCount}\n`;
        }

        // AVB version
        if (avbState.avbVersion) {
          result += `\n**AVB Version**: ${avbState.avbVersion}\n`;
        }

        // Rollback indices
        if (Object.keys(avbState.rollbackIndices).length > 0) {
          result += `\n## Rollback Indices\n\n`;
          for (const [idx, value] of Object.entries(avbState.rollbackIndices)) {
            result += `- Index ${idx}: ${value}\n`;
          }
        }

        return result;
      });
    }
  },

  get_bootloader_state: {
    description: `Get detailed bootloader state information.

Returns comprehensive bootloader information from fastboot getvar:
- Lock state (locked/unlocked)
- OEM unlock ability
- Anti-rollback version
- Secure boot status
- Hardware platform info
- Product variant

⚠️ REQUIRES FASTBOOT MODE ⚠️

Device must be in bootloader/fastboot mode. Use:
  reboot_device(device_id="...", mode="bootloader")

Examples:
- get_bootloader_state(device_id="ABC123") → Full bootloader info
- get_bootloader_state(device_id="ABC123", format="json") → Structured data`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID in fastboot mode'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof GetBootloaderStateSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'bootloader') {
          throw new Error(
            `Device must be in fastboot mode. Current: ${device.mode}. ` +
            `Use reboot_device(device_id="${args.device_id}", mode="bootloader") first.`
          );
        }

        const state: BootloaderState = {
          unlocked: false,
          unlockAbility: false,
          deviceState: 'unknown',
          rawVars: {},
        };

        // Get all variables
        const result = await CommandExecutor.fastboot(args.device_id, ['getvar', 'all']);
        const output = result.stderr || result.stdout;
        const lines = output.split('\n');

        for (const line of lines) {
          const match = line.match(/\(bootloader\)\s*([^:]+):\s*(.+)/);
          if (!match) continue;

          const key = match[1].trim().toLowerCase();
          const value = match[2].trim();

          state.rawVars[key] = value;

          // Parse known variables
          if (key === 'unlocked') {
            state.unlocked = value.toLowerCase() === 'yes';
            state.deviceState = state.unlocked ? 'unlocked' : 'locked';
          }
          if (key === 'unlock-ability' || key === 'unlockable') {
            state.unlockAbility = value === '1' || value.toLowerCase() === 'yes';
          }
          if (key === 'anti-rollback-version' || key.includes('rollback')) {
            state.antiRollbackVersion = parseInt(value, 10) || undefined;
          }
          if (key === 'secure' || key === 'secureboot') {
            state.secureBootEnabled = value.toLowerCase() === 'yes';
          }
          if (key === 'critical-unlocked' || key === 'flashing-unlocked') {
            state.criticalUnlocked = value.toLowerCase() === 'yes';
          }
          if (key === 'hw-platform' || key === 'platform') {
            state.hwPlatform = value;
          }
          if (key === 'variant') {
            state.variant = value;
          }
          if (key === 'serialno') {
            state.serialno = value;
          }
          if (key === 'product') {
            state.product = value;
          }
        }

        if (args.format === 'json') {
          return JSON.stringify(state, null, 2);
        }

        let markdown = `# Bootloader State: ${args.device_id}\n\n`;

        // Lock state
        const lockIcon = state.unlocked ? '🔓' : '🔒';
        markdown += `**State**: ${lockIcon} ${state.deviceState.toUpperCase()}\n`;
        markdown += `**Unlock Ability**: ${state.unlockAbility ? '✅ Enabled' : '❌ Disabled'}\n`;

        if (state.criticalUnlocked !== undefined) {
          markdown += `**Critical Partitions Unlocked**: ${state.criticalUnlocked ? 'Yes' : 'No'}\n`;
        }

        // Hardware info
        markdown += `\n## Hardware Info\n\n`;
        if (state.product) markdown += `**Product**: ${state.product}\n`;
        if (state.variant) markdown += `**Variant**: ${state.variant}\n`;
        if (state.hwPlatform) markdown += `**Platform**: ${state.hwPlatform}\n`;
        if (state.serialno) markdown += `**Serial**: ${state.serialno}\n`;

        // Security
        markdown += `\n## Security\n\n`;
        if (state.secureBootEnabled !== undefined) {
          markdown += `**Secure Boot**: ${state.secureBootEnabled ? 'Enabled' : 'Disabled'}\n`;
        }
        if (state.antiRollbackVersion !== undefined) {
          markdown += `**Anti-Rollback Version**: ${state.antiRollbackVersion}\n`;
        }

        // Raw variables count
        markdown += `\n*Total variables queried: ${Object.keys(state.rawVars).length}*`;

        return markdown;
      });
    }
  },

  detect_root_solution: {
    description: `Detect installed root solutions on device.

Detects all installed root solutions including:
- **Magisk**: Official, Delta, Alpha variants
- **KernelSU**: Official, Next, Legacy variants
- **APatch**: Official, Next variants
- **SukiSU**: Ultra variant
- **SuperSU**: Legacy chainfire root

Returns for each detected solution:
- Version information (binary + app versions)
- Package name (if app installed)
- Enabled features (Zygisk, Denylist, etc.)

Useful for:
- Determining which patching method to use
- Checking for conflicting root solutions
- Verifying root installation status

Examples:
- detect_root_solution(device_id="ABC123") → Detect all root solutions
- detect_root_solution(device_id="ABC123", format="json") → Structured data`,
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
    handler: async (args: z.infer<typeof DetectRootSolutionSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        if (device.mode !== 'device') {
          throw new Error(
            `Device must be in ADB mode. Current: ${device.mode}. ` +
            `Root detection requires booted Android system.`
          );
        }

        const solutions = await RootDetector.detectRootSolutions(args.device_id);
        const hasRoot = await RootDetector.hasRootAccess(args.device_id);

        if (args.format === 'json') {
          return JSON.stringify({
            hasRootAccess: hasRoot,
            solutions,
          }, null, 2);
        }

        let result = `# Root Detection: ${args.device_id}\n\n`;

        // Root access status
        const rootIcon = hasRoot ? '✅' : '❌';
        result += `**Root Access**: ${rootIcon} ${hasRoot ? 'Available' : 'Not Available'}\n\n`;

        if (solutions.length === 0) {
          result += `No root solutions detected.\n`;
          result += `\n*Note: Device may still have root via ADB root or engineering build.*`;
          return result;
        }

        result += `## Detected Solutions (${solutions.length})\n\n`;

        for (const solution of solutions) {
          const icon = solution.installed ? '✅' : '❌';
          result += `### ${icon} ${solution.solution.toUpperCase()}\n\n`;

          if (solution.version) {
            result += `- **Version**: ${solution.version}\n`;
          }
          if (solution.versionCode) {
            result += `- **Version Code**: ${solution.versionCode}\n`;
          }
          if (solution.appVersion) {
            result += `- **App Version**: ${solution.appVersion}\n`;
          }
          if (solution.packageName) {
            result += `- **Package**: ${solution.packageName}\n`;
          }
          if (solution.features.length > 0) {
            result += `- **Features**: ${solution.features.join(', ')}\n`;
          }
          result += `\n`;
        }

        return result;
      });
    }
  },

  get_slot_info: {
    description: `Get A/B partition slot information.

Returns detailed slot information for A/B partitioned devices:
- Whether device uses A/B slots
- Current active slot
- Slot health status (bootable, successful, retry count)
- Slot switching capability

A/B Slots enable seamless system updates by:
- Updating inactive slot while system runs
- Switching active slot after update
- Rolling back if update fails

Works in both ADB and fastboot modes:
- Fastboot mode provides more detailed slot metadata
- ADB mode only reports current slot

Examples:
- get_slot_info(device_id="ABC123") → Get slot information
- get_slot_info(device_id="ABC123", format="json") → Structured data`,
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
    handler: async (args: z.infer<typeof GetSlotInfoSchema>) => {
      return ErrorHandler.wrap(async () => {
        const device = await DeviceManager.validateDevice(args.device_id);

        const slotInfo = await AVBParser.getSlotInfo(args.device_id, device.mode);

        if (args.format === 'json') {
          return JSON.stringify(slotInfo, null, 2);
        }

        let result = `# Slot Information: ${args.device_id}\n\n`;

        if (!slotInfo.isAB) {
          result += `**Slot Type**: Single slot (legacy)\n\n`;
          result += `This device does not use A/B partitioning.\n`;
          result += `\n*Note: Seamless updates and slot switching not available.*`;
          return result;
        }

        result += `**Slot Type**: A/B (seamless updates)\n`;
        result += `**Current Slot**: ${slotInfo.currentSlot?.toUpperCase() || 'Unknown'}\n\n`;

        result += `## Slot Status\n\n`;
        result += `| Slot | Bootable | Successful | Retry Count |\n`;
        result += `|------|----------|------------|-------------|\n`;

        if (slotInfo.slotA) {
          const current = slotInfo.currentSlot === 'a' ? ' (active)' : '';
          result += `| A${current} | ${slotInfo.slotA.bootable ? '✅' : '❌'} | `;
          result += `${slotInfo.slotA.successful ? '✅' : '❌'} | `;
          result += `${slotInfo.slotA.retryCount} |\n`;
        }

        if (slotInfo.slotB) {
          const current = slotInfo.currentSlot === 'b' ? ' (active)' : '';
          result += `| B${current} | ${slotInfo.slotB.bootable ? '✅' : '❌'} | `;
          result += `${slotInfo.slotB.successful ? '✅' : '❌'} | `;
          result += `${slotInfo.slotB.retryCount} |\n`;
        }

        // Slot health assessment
        result += `\n## Health Assessment\n\n`;

        const inactiveSlot = slotInfo.currentSlot === 'a' ? slotInfo.slotB : slotInfo.slotA;
        const inactiveSlotName = slotInfo.currentSlot === 'a' ? 'B' : 'A';

        if (inactiveSlot) {
          if (!inactiveSlot.bootable) {
            result += `⚠️ **Warning**: Slot ${inactiveSlotName} is not bootable. `;
            result += `Consider flashing before switching.\n`;
          } else if (!inactiveSlot.successful) {
            result += `⚠️ **Warning**: Slot ${inactiveSlotName} has not booted successfully. `;
            result += `May indicate failed update.\n`;
          } else {
            result += `✅ Both slots appear healthy.\n`;
          }
        }

        result += `\n💡 **Tip**: Use \`set_active_slot\` to switch between slots.`;

        return result;
      });
    }
  },

  // Phase 6A: WiFi ADB Tools
  pair_device: {
    description: `Pair device for wireless debugging (Android 11+).

Initiates wireless ADB pairing with a device. Required for first-time wireless connection.

Prerequisites:
1. Device must be on the same network
2. Enable Developer Options > Wireless debugging
3. Tap "Pair device with pairing code" to get IP:port and 6-digit code

Examples:
- pair_device(ip_address="192.168.1.100", port=37123, pairing_code="123456")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        ip_address: {
          type: 'string' as const,
          description: 'IP address of the device'
        },
        port: {
          type: 'number' as const,
          description: 'Pairing port shown on device'
        },
        pairing_code: {
          type: 'string' as const,
          description: '6-digit pairing code from device'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['ip_address', 'port', 'pairing_code']
    },
    handler: async (args: z.infer<typeof PairDeviceSchema>) => {
      return ErrorHandler.wrap(async () => {
        // Validate IP address format
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(args.ip_address)) {
          throw new Error(`Invalid IP address format: ${args.ip_address}`);
        }

        // Validate port range
        if (args.port < 1 || args.port > 65535) {
          throw new Error(`Invalid port number: ${args.port}`);
        }

        // Validate pairing code (typically 6 digits)
        const codeRegex = /^\d{6}$/;
        if (!codeRegex.test(args.pairing_code)) {
          throw new Error('Pairing code must be 6 digits');
        }

        const target = `${args.ip_address}:${args.port}`;

        // Execute adb pair command
        const result = await CommandExecutor.adb(null, ['pair', target, args.pairing_code]);

        if (args.format === 'json') {
          return JSON.stringify({
            success: result.success,
            ip_address: args.ip_address,
            port: args.port,
            message: result.stdout || result.stderr,
          }, null, 2);
        }

        if (result.success && result.stdout.toLowerCase().includes('success')) {
          return `# Device Paired Successfully\n\n` +
            `**Target**: ${target}\n\n` +
            `✅ Device is now paired. Use \`connect_wireless_new\` to establish connection.\n\n` +
            `**Next step**: connect_wireless_new(ip_address="${args.ip_address}", port=5555)`;
        } else {
          return `# Pairing Failed\n\n` +
            `**Target**: ${target}\n\n` +
            `❌ ${result.stderr || result.stdout || 'Unknown error'}\n\n` +
            `**Tips**:\n` +
            `- Ensure device shows pairing dialog\n` +
            `- Check IP address and port\n` +
            `- Verify 6-digit code is correct`;
        }
      });
    }
  },

  connect_wireless_new: {
    description: `Connect to a paired device wirelessly.

Establishes wireless ADB connection to a previously paired device.

Prerequisites:
- Device must be paired first (use pair_device)
- Device must be on same network
- Wireless debugging must be enabled

Examples:
- connect_wireless_new(ip_address="192.168.1.100")
- connect_wireless_new(ip_address="192.168.1.100", port=5555)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        ip_address: {
          type: 'string' as const,
          description: 'IP address of the device'
        },
        port: {
          type: 'number' as const,
          default: 5555,
          description: 'Port number for wireless ADB'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['ip_address']
    },
    handler: async (args: z.infer<typeof ConnectWirelessNewSchema>) => {
      return ErrorHandler.wrap(async () => {
        // Validate IP address format
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(args.ip_address)) {
          throw new Error(`Invalid IP address format: ${args.ip_address}`);
        }

        const port = args.port || 5555;
        if (port < 1 || port > 65535) {
          throw new Error(`Invalid port number: ${port}`);
        }

        const target = `${args.ip_address}:${port}`;

        // Execute adb connect
        const result = await CommandExecutor.adb(null, ['connect', target]);

        const output = result.stdout + result.stderr;
        const connected = output.toLowerCase().includes('connected') &&
                         !output.toLowerCase().includes('cannot');

        if (args.format === 'json') {
          return JSON.stringify({
            success: connected,
            ip_address: args.ip_address,
            port: port,
            device_id: connected ? target : null,
            message: output.trim(),
          }, null, 2);
        }

        if (connected) {
          return `# Wireless Connection Established\n\n` +
            `**Device ID**: ${target}\n\n` +
            `✅ Connected wirelessly. You can now use this device ID for other operations.\n\n` +
            `**Note**: Use \`disconnect_wireless\` when done to free resources.`;
        } else {
          return `# Connection Failed\n\n` +
            `**Target**: ${target}\n\n` +
            `❌ ${output.trim()}\n\n` +
            `**Tips**:\n` +
            `- Ensure device is paired first\n` +
            `- Check that wireless debugging is still enabled\n` +
            `- Verify IP address hasn't changed`;
        }
      });
    }
  },

  disconnect_wireless: {
    description: `Disconnect a wireless ADB connection.

Disconnects a wirelessly connected device to free resources.

Examples:
- disconnect_wireless(ip_address="192.168.1.100")
- disconnect_wireless(ip_address="192.168.1.100", port=5555)`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        ip_address: {
          type: 'string' as const,
          description: 'IP address of the device to disconnect'
        },
        port: {
          type: 'number' as const,
          default: 5555,
          description: 'Port number'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['ip_address']
    },
    handler: async (args: z.infer<typeof DisconnectWirelessSchema>) => {
      return ErrorHandler.wrap(async () => {
        // Validate IP address format
        const ipRegex = /^(\d{1,3}\.){3}\d{1,3}$/;
        if (!ipRegex.test(args.ip_address)) {
          throw new Error(`Invalid IP address format: ${args.ip_address}`);
        }

        const port = args.port || 5555;
        const target = `${args.ip_address}:${port}`;

        // Execute adb disconnect
        const result = await CommandExecutor.adb(null, ['disconnect', target]);

        const output = result.stdout + result.stderr;
        const disconnected = output.toLowerCase().includes('disconnected');

        if (args.format === 'json') {
          return JSON.stringify({
            success: disconnected,
            ip_address: args.ip_address,
            port: port,
            message: output.trim(),
          }, null, 2);
        }

        if (disconnected) {
          return `# Device Disconnected\n\n` +
            `**Target**: ${target}\n\n` +
            `✅ Wireless connection closed.`;
        } else {
          return `# Disconnect Status\n\n` +
            `**Target**: ${target}\n\n` +
            `${output.trim() || 'Device may not have been connected.'}`;
        }
      });
    }
  },

  get_device_ip: {
    description: `Get the WiFi IP address of a connected device.

Retrieves the device's IP address on the WiFi network.
Useful for setting up wireless ADB.

Examples:
- get_device_ip(device_id="RF8M33...")`,
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
    handler: async (args: z.infer<typeof GetDeviceIpSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);

        // Try multiple methods to get IP
        let ipAddress: string | null = null;
        let method = '';

        // Method 1: ip addr show wlan0
        const ipResult = await CommandExecutor.shell(
          args.device_id,
          "ip addr show wlan0 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1"
        );
        if (ipResult.success && ipResult.stdout.trim()) {
          ipAddress = ipResult.stdout.trim().split('\n')[0];
          method = 'wlan0';
        }

        // Method 2: Try wlan1 if wlan0 failed
        if (!ipAddress) {
          const wlan1Result = await CommandExecutor.shell(
            args.device_id,
            "ip addr show wlan1 2>/dev/null | grep 'inet ' | awk '{print $2}' | cut -d/ -f1"
          );
          if (wlan1Result.success && wlan1Result.stdout.trim()) {
            ipAddress = wlan1Result.stdout.trim().split('\n')[0];
            method = 'wlan1';
          }
        }

        // Method 3: getprop
        if (!ipAddress) {
          const propResult = await CommandExecutor.shell(
            args.device_id,
            "getprop dhcp.wlan0.ipaddress 2>/dev/null"
          );
          if (propResult.success && propResult.stdout.trim()) {
            ipAddress = propResult.stdout.trim();
            method = 'dhcp prop';
          }
        }

        // Method 4: ifconfig fallback
        if (!ipAddress) {
          const ifconfigResult = await CommandExecutor.shell(
            args.device_id,
            "ifconfig wlan0 2>/dev/null | grep 'inet addr' | cut -d: -f2 | cut -d' ' -f1"
          );
          if (ifconfigResult.success && ifconfigResult.stdout.trim()) {
            ipAddress = ifconfigResult.stdout.trim();
            method = 'ifconfig';
          }
        }

        if (args.format === 'json') {
          return JSON.stringify({
            device_id: args.device_id,
            ip_address: ipAddress,
            method: method || null,
            found: !!ipAddress,
          }, null, 2);
        }

        if (ipAddress) {
          return `# Device IP Address\n\n` +
            `**Device**: ${args.device_id}\n` +
            `**IP Address**: ${ipAddress}\n` +
            `**Interface**: ${method}\n\n` +
            `To connect wirelessly:\n` +
            `1. Enable Wireless debugging on device\n` +
            `2. Use \`pair_device\` with pairing code\n` +
            `3. Then \`connect_wireless_new(ip_address="${ipAddress}")\``;
        } else {
          return `# IP Address Not Found\n\n` +
            `**Device**: ${args.device_id}\n\n` +
            `❌ Could not determine WiFi IP address.\n\n` +
            `**Possible reasons**:\n` +
            `- Device not connected to WiFi\n` +
            `- WiFi interface has different name\n` +
            `- Check Settings > About > IP address manually`;
        }
      });
    }
  }
};

// Helper function for parsing storage info
function parseStorageInfo(output: string) {
  const lines = output.split('\n').filter(l => l.includes('/'));
  return lines.map(line => {
    const parts = line.split(/\s+/);
    return {
      filesystem: parts[0],
      size: parts[1],
      used: parts[2],
      available: parts[3],
      use_percent: parts[4],
      mounted: parts[5]
    };
  });
}
