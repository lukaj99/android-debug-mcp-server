/**
 * Device management and validation utility
 */

import { CommandExecutor } from './executor.js';
import { CONFIG, ERROR_MESSAGES } from '../config.js';
import type { Device, DeviceMode } from '../types.js';

export class DeviceManager {
  private static deviceCache: Map<string, Device> = new Map();
  private static lastRefresh = 0;

  /**
   * List all connected devices (ADB + Fastboot)
   */
  static async listDevices(forceRefresh = false): Promise<Device[]> {
    const now = Date.now();

    if (!forceRefresh && now - this.lastRefresh < CONFIG.DEVICE_CACHE_TTL) {
      return Array.from(this.deviceCache.values());
    }

    const devices: Device[] = [];

    // Run discovery in parallel
    const [adbResult, fastbootResult] = await Promise.allSettled([
      CommandExecutor.adb(null, ['devices', '-l']),
      CommandExecutor.fastboot(null, ['devices', '-l'])
    ]);

    // Process ADB results
    if (adbResult.status === 'fulfilled') {
      try {
        const adbDevices = this.parseAdbDevices(adbResult.value.stdout);
        devices.push(...adbDevices);
      } catch (error) {
        console.error(`Failed to parse ADB output: ${error}`);
      }
    } else {
      // ADB not available - log for debugging but continue
      console.error(`ADB devices check failed: ${adbResult.reason instanceof Error ? adbResult.reason.message : String(adbResult.reason)}`);
    }

    // Process Fastboot results
    if (fastbootResult.status === 'fulfilled') {
      try {
        const fastbootDevices = this.parseFastbootDevices(fastbootResult.value.stdout);
        devices.push(...fastbootDevices);
      } catch (error) {
        console.error(`Failed to parse Fastboot output: ${error}`);
      }
    } else {
      // Fastboot not available - log for debugging but continue
      console.error(`Fastboot devices check failed: ${fastbootResult.reason instanceof Error ? fastbootResult.reason.message : String(fastbootResult.reason)}`);
    }

    // Update cache
    this.deviceCache.clear();
    devices.forEach(device => this.deviceCache.set(device.id, device));
    this.lastRefresh = now;

    return devices;
  }

  /**
   * Validate device exists and is accessible
   */
  static async validateDevice(deviceId: string): Promise<Device> {
    const devices = await this.listDevices();
    const device = devices.find(d => d.id === deviceId);

    if (!device) {
      const available = devices.map(d => d.id);
      throw new Error(ERROR_MESSAGES.DEVICE_NOT_FOUND(deviceId, available));
    }

    if (device.mode === 'unauthorized') {
      throw new Error(ERROR_MESSAGES.PERMISSION_DENIED);
    }

    if (device.mode === 'offline') {
      throw new Error(`Device '${deviceId}' is offline. Try reconnecting or rebooting the device.`);
    }

    return device;
  }

  /**
   * Parse ADB devices output
   */
  private static parseAdbDevices(output: string): Device[] {
    const devices: Device[] = [];
    const lines = output.split('\n').slice(1); // Skip header

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const id = parts[0];
      const mode = parts[1] as DeviceMode;

      const device: Device = { id, mode };

      // Parse additional info
      const infoMatch = line.match(/model:(\S+)|product:(\S+)|transport:(\S+)/g);
      if (infoMatch) {
        infoMatch.forEach(info => {
          const [key, value] = info.split(':');
          if (key === 'model') device.model = value;
          if (key === 'product') device.product = value;
          if (key === 'transport') device.transport = value;
        });
      }

      devices.push(device);
    }

    return devices;
  }

  /**
   * Parse Fastboot devices output
   */
  private static parseFastbootDevices(output: string): Device[] {
    const devices: Device[] = [];
    const lines = output.split('\n');

    for (const line of lines) {
      if (!line.trim()) continue;

      const parts = line.trim().split(/\s+/);
      if (parts.length < 2) continue;

      const id = parts[0];

      devices.push({
        id,
        mode: 'bootloader'
      });
    }

    return devices;
  }

  /**
   * Check if device is in specific mode
   */
  static async isInMode(deviceId: string, mode: DeviceMode): Promise<boolean> {
    try {
      const device = await this.validateDevice(deviceId);
      return device.mode === mode;
    } catch (error) {
      // Device not found or validation failed - return false as expected behavior
      console.error(`Device mode check failed for ${deviceId}: ${error instanceof Error ? error.message : String(error)}`);
      return false;
    }
  }

  /**
   * Validate device exists and is in required mode, throwing helpful error if not
   */
  static async requireMode(deviceId: string, requiredMode: 'device' | 'bootloader'): Promise<Device> {
    const device = await this.validateDevice(deviceId);

    if (device.mode !== requiredMode) {
      if (requiredMode === 'bootloader') {
        throw new Error(
          `Device must be in fastboot mode. Current: ${device.mode}. ` +
          `Use reboot_device(device_id="${deviceId}", mode="bootloader") first.`
        );
      } else {
        throw new Error(
          `Device must be in ADB mode. Current mode: ${device.mode}\n\n` +
          `Use reboot_device(device_id="${deviceId}", mode="system") to reboot to ADB mode.`
        );
      }
    }

    return device;
  }

  /**
   * Clear device cache (force refresh on next call)
   */
  static clearCache(): void {
    this.deviceCache.clear();
    this.lastRefresh = 0;
  }
}
