/**
 * Safety validation utility for destructive operations
 */

import { CONFIG, ERROR_MESSAGES } from '../config.js';
import { ANDROID_KEYCODES, type PartitionInfo } from '../types.js';

export class SafetyValidator {
  /**
   * Validate confirmation token for destructive operations
   */
  static validateConfirmationToken(
    operation: string,
    providedToken: string | undefined
  ): void {
    if (!providedToken) {
      throw new Error(ERROR_MESSAGES.INVALID_CONFIRMATION(operation));
    }

    // Expected format: CONFIRM_<OPERATION>_<timestamp>
    const expectedPrefix = `CONFIRM_${operation.toUpperCase()}_`;

    if (!providedToken.startsWith(expectedPrefix)) {
      throw new Error(
        ERROR_MESSAGES.INVALID_CONFIRMATION(operation) +
        `\n\nExpected format: ${expectedPrefix}<timestamp>\nExample: ${expectedPrefix}${Date.now()}`
      );
    }

    // Validate timestamp is recent (within last 60 seconds)
    const timestampStr = providedToken.replace(expectedPrefix, '');
    const timestamp = parseInt(timestampStr, 10);

    if (isNaN(timestamp)) {
      throw new Error(`Invalid confirmation token timestamp: ${timestampStr}`);
    }

    const now = Date.now();
    const age = now - timestamp;

    if (age > CONFIG.TOKEN_EXPIRY) {
      throw new Error(
        `Confirmation token expired (${Math.round(age / 1000)}s old, max ${CONFIG.TOKEN_EXPIRY / 1000}s). Generate a new token: ${expectedPrefix}${now}`
      );
    }

    if (age < 0) {
      throw new Error('Confirmation token timestamp is in the future. Check system clock.');
    }
  }

  /**
   * Generate confirmation token for destructive operation
   */
  static generateConfirmationToken(operation: string): string {
    return `CONFIRM_${operation.toUpperCase()}_${Date.now()}`;
  }

  /**
   * Check if operation is destructive
   */
  static isDestructive(operation: string): boolean {
    return (CONFIG.DESTRUCTIVE_OPERATIONS as readonly string[]).includes(operation);
  }

  /**
   * Validate device path format
   */
  static validateDevicePath(path: string): void {
    if (!path || path.trim() === '') {
      throw new Error('Device path cannot be empty');
    }

    if (path.includes('..')) {
      throw new Error('Device path cannot contain ".." (directory traversal)');
    }
  }

  /**
   * Validate partition name
   */
  static validatePartitionName(partition: string): void {
    const validPartitions = [
      'boot', 'boot_a', 'boot_b',
      'system', 'system_a', 'system_b',
      'vendor', 'vendor_a', 'vendor_b',
      'recovery', 'recovery_a', 'recovery_b',
      'userdata', 'cache', 'metadata',
      'vbmeta', 'vbmeta_a', 'vbmeta_b',
      'dtbo', 'dtbo_a', 'dtbo_b',
      'super', 'super_a', 'super_b'
    ];

    const lowerPartition = partition.toLowerCase();
    if (!validPartitions.includes(lowerPartition)) {
      throw new Error(
        `Invalid partition name: ${partition}. ` +
        `Valid partitions: ${validPartitions.slice(0, 10).join(', ')}, ...`
      );
    }
  }

  /**
   * Validate APK path
   */
  static validateApkPath(path: string): void {
    if (!path.endsWith('.apk')) {
      throw new Error('File must be an APK (*.apk extension)');
    }

    this.validateDevicePath(path);
  }

  /**
   * Validate package name format
   */
  static validatePackageName(packageName: string): void {
    const pattern = /^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$/;

    if (!pattern.test(packageName)) {
      throw new Error(
        `Invalid package name format: ${packageName}. ` +
        `Expected format: com.example.app`
      );
    }
  }

  /**
   * Validate shell command for security (prevent command injection)
   */
  static validateShellCommand(command: string): void {
    if (!command || command.trim() === '') {
      throw new Error('Shell command cannot be empty');
    }

    // Check for dangerous shell metacharacters that could enable command injection
    const dangerousPatterns = [
      /[;&|`$(){}[\]<>]/,  // Shell metacharacters
      /\$\(/,              // Command substitution
      /`/,                 // Backtick command substitution
      /\|\|/,              // OR operator
      /&&/,                // AND operator
      />\s*[/&]/,          // Output redirection with special chars
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(command)) {
        throw new Error(
          `Shell command contains potentially dangerous characters or patterns. ` +
          `For security reasons, commands with shell metacharacters (;&|$(){}[]<>\`&&||) are not allowed. ` +
          `Use specific tools instead of execute_shell() when possible.`
        );
      }
    }

    // Warn about commands that are particularly risky
    const riskyCommands = ['rm', 'dd', 'format', 'fdisk', 'mkfs'];
    const commandStart = command.trim().split(/\s+/)[0];
    
    if (riskyCommands.includes(commandStart)) {
      throw new Error(
        `Command '${commandStart}' is considered high-risk and blocked by execute_shell(). ` +
        `Use specific tools (erase_partition, format_partition, etc.) for destructive operations.`
      );
    }
  }

  /**
   * Validate screen coordinates for input simulation
   */
  static validateCoordinates(
    x: number,
    y: number,
    screenWidth?: number,
    screenHeight?: number
  ): void {
    if (!Number.isInteger(x) || x < 0) {
      throw new Error(
        `Invalid X coordinate: ${x}. Must be a non-negative integer.`
      );
    }

    if (!Number.isInteger(y) || y < 0) {
      throw new Error(
        `Invalid Y coordinate: ${y}. Must be a non-negative integer.`
      );
    }

    if (screenWidth !== undefined && x > screenWidth) {
      throw new Error(
        `X coordinate ${x} exceeds screen width ${screenWidth}. ` +
        `Valid range: 0-${screenWidth}`
      );
    }

    if (screenHeight !== undefined && y > screenHeight) {
      throw new Error(
        `Y coordinate ${y} exceeds screen height ${screenHeight}. ` +
        `Valid range: 0-${screenHeight}`
      );
    }
  }

  /**
   * Escape text for Android shell input command
   * Replaces spaces with %s and escapes special shell characters
   */
  static escapeShellText(text: string): string {
    // First escape backslashes, then other special chars
    return text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\$/g, '\\$')
      .replace(/'/g, "\\'")
      .replace(/`/g, '\\`')
      .replace(/ /g, '%s');
  }

  /**
   * Validate Android keycode and return its numeric value
   */
  static validateKeycode(keycode: string): number {
    const keycodeUpper = keycode.toUpperCase();
    const keycodeNumber = ANDROID_KEYCODES[keycodeUpper];

    if (keycodeNumber === undefined) {
      const validKeys = Object.keys(ANDROID_KEYCODES).slice(0, 20).join(', ');
      throw new Error(
        `Invalid keycode: "${keycode}"\n\n` +
        `Valid keycodes include: ${validKeys}, ...\n` +
        `See Android KeyEvent documentation for complete list.`
      );
    }

    return keycodeNumber;
  }

  /**
   * Validate partition exists in the provided list and return partition info
   */
  static validatePartitionExists(
    partitionName: string,
    availablePartitions: PartitionInfo[]
  ): PartitionInfo {
    const partition = availablePartitions.find(
      p => p.name === partitionName || p.name === partitionName.toLowerCase()
    );

    if (!partition) {
      const available = availablePartitions
        .map(p => p.name)
        .slice(0, 20)
        .join(', ');
      throw new Error(
        `Partition "${partitionName}" not found on device.\n\n` +
        `Available partitions: ${available}${availablePartitions.length > 20 ? ', ...' : ''}`
      );
    }

    return partition;
  }

  /**
   * Check if partition is critical (system-critical partition)
   */
  static isCriticalPartition(partitionName: string): boolean {
    const criticalPartitions = [
      'boot', 'boot_a', 'boot_b',
      'system', 'system_a', 'system_b',
      'vendor', 'vendor_a', 'vendor_b',
      'userdata', 'metadata',
      'vbmeta', 'vbmeta_a', 'vbmeta_b',
      'super', 'super_a', 'super_b',
      'bootloader', 'bootloader_a', 'bootloader_b',
      'radio', 'radio_a', 'radio_b',
      'modem', 'modem_a', 'modem_b'
    ];

    return criticalPartitions.includes(partitionName.toLowerCase());
  }
}
