/**
 * Error handling utility with actionable error messages
 */

import { ResponseFormatter } from './formatter.js';

export class ErrorHandler {
  /**
   * Handle and format errors with suggestions
   */
  static handle(error: unknown): string {
    if (error instanceof Error) {
      return this.handleError(error);
    }

    return ResponseFormatter.error(
      'An unknown error occurred',
      'Check logs for details'
    );
  }

  /**
   * Handle Error objects
   */
  private static handleError(error: Error): string {
    const message = error.message;

    // Device not found
    if (message.includes('Device') && message.includes('not found')) {
      return ResponseFormatter.error(
        message,
        'Use list_devices() to see all connected devices, then try again with the correct device ID'
      );
    }

    // USB debugging not authorized
    if (message.includes('unauthorized') || message.includes('authorization')) {
      return ResponseFormatter.error(
        message,
        'Check your Android device screen for USB debugging authorization prompt and tap "Allow"'
      );
    }

    // Bootloader locked
    if (message.includes('bootloader') && message.includes('locked')) {
      return ResponseFormatter.error(
        message,
        'To unlock bootloader: use unlock_bootloader() (WARNING: this will wipe all data on the device!)'
      );
    }

    // Permission denied
    if (message.includes('permission denied')) {
      return ResponseFormatter.error(
        message,
        'Ensure USB debugging is enabled and device is authorized. On the device: Settings > Developer Options > USB Debugging'
      );
    }

    // ADB/Fastboot not found
    if (message.includes('not found') && (message.includes('adb') || message.includes('fastboot'))) {
      return ResponseFormatter.error(
        message,
        'Install Android Platform Tools from https://developer.android.com/tools/releases/platform-tools and ensure they are in your system PATH'
      );
    }

    // Timeout
    if (message.includes('timeout') || message.includes('timed out')) {
      return ResponseFormatter.error(
        message,
        'The operation took too long. Try again or check device connection. For large operations, consider splitting into smaller tasks.'
      );
    }

    // Invalid confirmation token
    if (message.includes('confirmation token')) {
      return ResponseFormatter.error(
        message,
        'For destructive operations, you must provide a valid confirmation token to prevent accidental data loss'
      );
    }

    // Partition errors
    if (message.includes('partition')) {
      return ResponseFormatter.error(
        message,
        'Ensure device is in fastboot mode and partition name is correct. Use get_device_info() to check current mode.'
      );
    }

    // Generic error
    return ResponseFormatter.error(message);
  }

  /**
   * Wrap async function with error handling
   */
  static async wrap<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      throw new Error(this.handle(error));
    }
  }
}
