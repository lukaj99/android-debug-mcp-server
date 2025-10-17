/**
 * Command execution utility for ADB and Fastboot operations
 */

import { spawn } from 'child_process';
import { CONFIG, ERROR_MESSAGES } from '../config.js';
import type { CommandResult } from '../types.js';
import { PlatformToolsManager } from './platform-tools-manager.js';

export class CommandExecutor {
  private static autoInstallAttempted = false;

  /**
   * Execute a command with timeout and error handling
   */
  static async execute(
    command: string,
    args: string[],
    options: { timeout?: number; deviceId?: string; skipAutoInstall?: boolean } = {}
  ): Promise<CommandResult> {
    const timeout = options.timeout || CONFIG.COMMAND_TIMEOUT;

    return new Promise((resolve, reject) => {
      let stdout = '';
      let stderr = '';
      let isResolved = false;

      const child = spawn(command, args, {
        env: process.env
      });

      // Set up timeout handler
      const timeoutId = setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          child.kill('SIGTERM');
          reject(new Error(`Command timed out after ${timeout}ms: ${command} ${args.join(' ')}`));
        }
      }, timeout);

      child.stdout.on('data', (data) => {
        stdout += data.toString();
      });

      child.stderr.on('data', (data) => {
        stderr += data.toString();
      });

      child.on('close', (exitCode) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutId);
          resolve({
            stdout: stdout.trim(),
            stderr: stderr.trim(),
            exitCode: exitCode || 0,
            success: exitCode === 0
          });
        }
      });

      child.on('error', async (error) => {
        if (!isResolved) {
          isResolved = true;
          clearTimeout(timeoutId);
          
          // Handle ENOENT (command not found) errors
          if (error.message.includes('ENOENT')) {
            const isAdb = command.includes('adb');
            const isFastboot = command.includes('fastboot');
            
            // Only attempt auto-install once per session and if not explicitly skipped
            if ((isAdb || isFastboot) && !this.autoInstallAttempted && !options.skipAutoInstall) {
              this.autoInstallAttempted = true;
              
              console.error('\n⚠️  Android Platform Tools not found. Attempting automatic installation...\n');
              
              try {
                // Attempt to download and install platform tools
                const result = await PlatformToolsManager.downloadAndInstall(false);
                console.error('\n' + result + '\n');
                
                // Get the newly installed binary paths
                const installedTools = PlatformToolsManager.getBinaryPaths();
                if (!installedTools) {
                  throw new Error('Installation verification failed');
                }
                
                // Update the command path and retry
                const newCommand = isAdb ? installedTools.adb : (isFastboot ? installedTools.fastboot : command);
                console.error(`Retrying command with installed tools: ${newCommand}\n`);
                
                // Retry the command with the new path
                try {
                  const retryResult = await this.execute(newCommand, args, { ...options, skipAutoInstall: true });
                  resolve(retryResult);
                  return;
                } catch (retryError) {
                  reject(retryError);
                  return;
                }
              } catch (installError) {
                console.error(`\n❌ Auto-installation failed: ${installError instanceof Error ? installError.message : String(installError)}\n`);
                // Fall through to original error messages
              }
            }
            
            // If auto-install was skipped or failed, show original error
            if (isAdb) {
              reject(new Error(ERROR_MESSAGES.ADB_NOT_FOUND));
              return;
            } else if (isFastboot) {
              reject(new Error(ERROR_MESSAGES.FASTBOOT_NOT_FOUND));
              return;
            }
          }
          reject(error);
        }
      });
    });
  }

  /**
   * Execute ADB command for specific device
   */
  static async adb(deviceId: string | null, args: string[]): Promise<CommandResult> {
    const fullArgs = deviceId ? ['-s', deviceId, ...args] : args;
    return this.execute(CONFIG.ADB_PATH, fullArgs);
  }

  /**
   * Execute Fastboot command for specific device
   */
  static async fastboot(deviceId: string | null, args: string[]): Promise<CommandResult> {
    const fullArgs = deviceId ? ['-s', deviceId, ...args] : args;
    return this.execute(CONFIG.FASTBOOT_PATH, fullArgs);
  }

  /**
   * Execute ADB shell command
   */
  static async shell(deviceId: string, command: string): Promise<CommandResult> {
    return this.adb(deviceId, ['shell', command]);
  }

  /**
   * Stream logcat output (limited to MAX_LOG_LINES)
   */
  static async logcat(deviceId: string, filter?: string): Promise<string> {
    const args = ['logcat', '-d', '-v', 'time'];
    if (filter) {
      args.push(filter);
    }

    const result = await this.adb(deviceId, args);

    if (!result.success) {
      throw new Error(`Failed to get logs: ${result.stderr}`);
    }

    // Limit lines
    const lines = result.stdout.split('\n');
    const limited = lines.slice(-CONFIG.MAX_LOG_LINES);

    return limited.join('\n');
  }
}
