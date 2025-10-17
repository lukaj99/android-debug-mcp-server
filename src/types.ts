/**
 * TypeScript type definitions for Android Debug MCP Server
 */

export type DeviceMode = 'device' | 'bootloader' | 'recovery' | 'sideload' | 'unauthorized' | 'offline';

export type RebootMode = 'system' | 'bootloader' | 'recovery' | 'fastboot' | 'fastbootd' | 'sideload';

export type OutputFormat = 'markdown' | 'json';

export type DetailLevel = 'concise' | 'detailed';

export type AppFilter = 'all' | 'user' | 'system' | 'enabled' | 'disabled' | 'third-party';

export type AppAction = 'enable' | 'disable' | 'clear-data' | 'force-stop' | 'grant-permission' | 'revoke-permission';

export type SlotName = 'a' | 'b' | 'all' | 'other';

export interface Device {
  id: string;
  mode: DeviceMode;
  model?: string;
  product?: string;
  transport?: string;
}

export interface DeviceInfo {
  id: string;
  mode: DeviceMode;
  model: string;
  manufacturer: string;
  androidVersion: string;
  sdkVersion: string;
  buildId: string;
  serialNumber: string;
  isRooted: boolean;
  bootloaderUnlocked: boolean;
  batteryLevel?: number;
  batteryStatus?: string;
  ip?: string;
  adbWifi?: boolean;
}

export interface Package {
  name: string;
  path: string;
  enabled: boolean;
  system: boolean;
  versionName?: string;
  versionCode?: string;
  size?: number;
}

export interface FileInfo {
  path: string;
  name: string;
  type: 'file' | 'directory' | 'symlink';
  size: number;
  permissions: string;
  owner: string;
  group: string;
  modified: string;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
  exitCode: number;
  success: boolean;
}

export interface PartitionInfo {
  name: string;
  size: string;
  active?: boolean;
  slot?: string;
}

export interface FlashOptions {
  wipeData?: boolean;
  disableVerity?: boolean;
  disableVerification?: boolean;
  skipReboot?: boolean;
}

export interface InstallOptions {
  replace?: boolean;
  downgrade?: boolean;
  grantPermissions?: boolean;
  allowTestPackages?: boolean;
}
