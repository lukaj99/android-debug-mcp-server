/**
 * Device management tools
 */

import { z } from 'zod';
import { DeviceManager } from '../utils/device-manager.js';
import { CommandExecutor } from '../utils/executor.js';
import { ResponseFormatter } from '../utils/formatter.js';
import { ErrorHandler } from '../utils/error-handler.js';
import { PlatformToolsManager } from '../utils/platform-tools-manager.js';
import { CONFIG } from '../config.js';
import type { DeviceInfo, RebootMode, DeviceHealth } from '../types.js';

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
        await new Promise(resolve => setTimeout(resolve, CONFIG.WIRELESS_CONNECT_DELAY));

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

        const health: DeviceHealth = {};

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
