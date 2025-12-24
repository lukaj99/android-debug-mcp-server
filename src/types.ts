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
  device: string;
  blockDevice: string;
  sizeBytes: number;
  sizeHuman: string;
  critical: boolean;
}

export interface PartitionBackup {
  partition: string;
  outputPath: string;
  sizeBytes: number;
  sizeHuman: string;
  sha256?: string;
  timestamp: string;
  duration?: string;
}

export interface ScreenInfo {
  width: number;
  height: number;
  density: number;
  densityDpi: number;
  orientation: 'portrait' | 'landscape';
  rotation: 0 | 90 | 180 | 270;
}

export interface Screenshot {
  path: string;
  sizeBytes: number;
  timestamp: string;
  base64?: string;
}

export interface Recording {
  path: string;
  sizeBytes: number;
  durationSeconds: number;
  bitRate: string;
  timestamp: string;
}

export interface FlashOptions {
  wipeData?: boolean;
  disableVerity?: boolean;
  disableVerification?: boolean;
  skipReboot?: boolean;
}

// AVB (Android Verified Boot) types
export interface VerityState {
  verity: boolean;
  verification: boolean;
  raw: string;
}

export interface AVBState {
  unlocked: boolean;
  verityEnabled: boolean;
  verificationEnabled: boolean;
  stateCode: number;
  stateDescription: string;
  slots: Record<string, VerityState>;
  rollbackIndices: Record<string, number>;
  slotCount?: number;
  currentSlot?: string;
  avbVersion?: string;
}

// Root solution types
export type RootSolution =
  | 'magisk'
  | 'kernelsu'
  | 'kernelsu-next'
  | 'apatch'
  | 'apatch-next'
  | 'sukisu'
  | 'supersu'
  | 'none';

export interface RootSolutionInfo {
  solution: RootSolution;
  installed: boolean;
  version: string | null;
  versionCode: number | null;
  appVersion: string | null;
  packageName: string | null;
  features: string[];
}

// Image validation types
export interface BootImageInfo {
  headerVersion: number;
  kernelSize: number;
  ramdiskSize: number;
  pageSize: number;
  osVersion?: string;
  osPatchLevel?: string;
  cmdline?: string;
}

export interface ImageValidationResult {
  valid: boolean;
  path: string;
  exists: boolean;
  size: number;
  sizeHuman: string;
  sha256: string;
  type: 'boot' | 'vendor_boot' | 'vbmeta' | 'sparse' | 'unknown';
  bootImageInfo?: BootImageInfo;
  warnings: string[];
  errors: string[];
}

// Slot information types
export interface SlotInfo {
  isAB: boolean;
  currentSlot?: string;
  slotA?: {
    bootable: boolean;
    successful: boolean;
    retryCount: number;
  };
  slotB?: {
    bootable: boolean;
    successful: boolean;
    retryCount: number;
  };
}

// Bootloader state types
export interface BootloaderState {
  unlocked: boolean;
  unlockAbility: boolean;
  antiRollbackVersion?: number;
  secureBootEnabled?: boolean;
  deviceState: 'locked' | 'unlocked' | 'unknown';
  criticalUnlocked?: boolean;
  hwPlatform?: string;
  variant?: string;
  serialno?: string;
  product?: string;
  rawVars: Record<string, string>;
}

// Downgrade check types
export interface DowngradeCheckResult {
  isDowngrade: boolean;
  riskLevel: 'none' | 'low' | 'medium' | 'high';
  warnings: string[];
  currentBuildDate?: string;
  newBuildDate?: string;
  currentSPL?: string;
  newSPL?: string;
}

export interface InstallOptions {
  replace?: boolean;
  downgrade?: boolean;
  grantPermissions?: boolean;
  allowTestPackages?: boolean;
}

// Android keycode mappings for input simulation
export const ANDROID_KEYCODES: Record<string, number> = {
  HOME: 3,
  BACK: 4,
  CALL: 5,
  ENDCALL: 6,
  VOLUME_UP: 24,
  VOLUME_DOWN: 25,
  POWER: 26,
  CAMERA: 27,
  CLEAR: 28,
  MENU: 82,
  SEARCH: 84,
  ENTER: 66,
  DEL: 67,
  DELETE: 67,
  TAB: 61,
  SPACE: 62,
  MOVE_HOME: 122,
  MOVE_END: 123,
  DPAD_UP: 19,
  DPAD_DOWN: 20,
  DPAD_LEFT: 21,
  DPAD_RIGHT: 22,
  DPAD_CENTER: 23,
  PAGE_UP: 92,
  PAGE_DOWN: 93,
  ESC: 111,
  ESCAPE: 111,
  FORWARD_DEL: 112,
  CTRL_LEFT: 113,
  CTRL_RIGHT: 114,
  CAPS_LOCK: 115,
  SCROLL_LOCK: 116,
  META_LEFT: 117,
  META_RIGHT: 118,
  FUNCTION: 119,
  SYSRQ: 120,
  BREAK: 121,
  INSERT: 124,
  FORWARD: 125,
  MEDIA_PLAY: 126,
  MEDIA_PAUSE: 127,
  MEDIA_CLOSE: 128,
  MEDIA_EJECT: 129,
  MEDIA_RECORD: 130,
  F1: 131,
  F2: 132,
  F3: 133,
  F4: 134,
  F5: 135,
  F6: 136,
  F7: 137,
  F8: 138,
  F9: 139,
  F10: 140,
  F11: 141,
  F12: 142,
  NUM_LOCK: 143,
  NUMPAD_0: 144,
  NUMPAD_1: 145,
  NUMPAD_2: 146,
  NUMPAD_3: 147,
  NUMPAD_4: 148,
  NUMPAD_5: 149,
  NUMPAD_6: 150,
  NUMPAD_7: 151,
  NUMPAD_8: 152,
  NUMPAD_9: 153,
  MEDIA_PLAY_PAUSE: 85,
  MEDIA_STOP: 86,
  MEDIA_NEXT: 87,
  MEDIA_PREVIOUS: 88,
  MEDIA_REWIND: 89,
  MEDIA_FAST_FORWARD: 90,
  MUTE: 91,
  BRIGHTNESS_DOWN: 220,
  BRIGHTNESS_UP: 221
}
