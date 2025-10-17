/**
 * Configuration constants for Android Debug MCP Server
 */

import { PlatformToolsManager } from './utils/platform-tools-manager.js';

// Get installed platform tools paths if available
const installedTools = PlatformToolsManager.getBinaryPaths();

export const CONFIG = {
  // Command execution
  ADB_PATH: process.env.ADB_PATH || installedTools?.adb || 'adb',
  FASTBOOT_PATH: process.env.FASTBOOT_PATH || installedTools?.fastboot || 'fastboot',
  COMMAND_TIMEOUT: parseInt(process.env.COMMAND_TIMEOUT || '30000', 10),

  // Response formatting
  CHARACTER_LIMIT: parseInt(process.env.CHARACTER_LIMIT || '25000', 10),
  MAX_LOG_LINES: parseInt(process.env.MAX_LOG_LINES || '1000', 10),

  // Tool annotations
  READ_ONLY_HINT: true,
  IDEMPOTENT_HINT: true,

  // Safety
  DESTRUCTIVE_OPERATIONS: [
    'unlock_bootloader',
    'lock_bootloader',
    'flash_partition',
    'erase_partition',
    'format_partition',
    'flash_all'
  ]
} as const;

export const ERROR_MESSAGES = {
  DEVICE_NOT_FOUND: (deviceId: string, available: string[]) =>
    `Device '${deviceId}' not found. Available devices: ${available.join(', ')}. Use list_devices() to see all connected devices.`,

  NO_DEVICES: 'No Android devices found. Ensure USB debugging is enabled and device is connected.',

  INVALID_CONFIRMATION: (operation: string) =>
    `Missing or invalid confirmation token for ${operation}. Destructive operations require confirm_token parameter. Format: CONFIRM_${operation.toUpperCase()}_<timestamp>`,

  PERMISSION_DENIED: 'USB debugging not authorized. Check device screen for authorization prompt.',

  BOOTLOADER_LOCKED: 'Bootloader is locked. Cannot flash partitions. Use unlock_bootloader() first (WARNING: wipes all data).',

  COMMAND_FAILED: (cmd: string, stderr: string, exitCode: number) =>
    `Command failed: ${cmd}\nExit code: ${exitCode}\nError: ${stderr}`,

  ADB_NOT_FOUND: 'ADB not found. Install Android Platform Tools: https://developer.android.com/tools/releases/platform-tools',

  FASTBOOT_NOT_FOUND: 'Fastboot not found. Install Android Platform Tools: https://developer.android.com/tools/releases/platform-tools'
} as const;
