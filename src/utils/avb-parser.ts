/**
 * AVB (Android Verified Boot) Parser
 * Parses vbmeta images and device verification state
 *
 * Based on PixelFlasher's vbmeta parsing logic (phone.py:1250-1327)
 */

import { CommandExecutor } from './executor.js';
import type { AVBState, VerityState } from '../types.js';

/**
 * AVB verification states from vbmeta header at offset 123
 * See: https://android.googlesource.com/platform/external/avb/+/master/libavb/avb_vbmeta_image.h
 */
export const AVB_STATES = {
  0: { verity: true, verification: true, description: 'Verified Boot enabled (default)' },
  1: { verity: false, verification: true, description: 'Verity disabled, verification enabled' },
  2: { verity: true, verification: false, description: 'Verity enabled, verification disabled' },
  3: { verity: false, verification: false, description: 'All verification disabled (unlocked)' },
} as const;

export class AVBParser {
  /**
   * Get AVB state from device
   * Requires: fastboot mode OR root access in ADB mode
   */
  static async getAVBState(deviceId: string, mode: string): Promise<AVBState> {
    if (mode === 'bootloader') {
      return this.getAVBStateFromFastboot(deviceId);
    } else if (mode === 'device') {
      return this.getAVBStateFromADB(deviceId);
    }

    throw new Error(
      `Cannot query AVB state in ${mode} mode. ` +
      `Device must be in fastboot or ADB mode.`
    );
  }

  /**
   * Get AVB state via fastboot getvar
   */
  private static async getAVBStateFromFastboot(deviceId: string): Promise<AVBState> {
    const result: AVBState = {
      unlocked: false,
      verityEnabled: true,
      verificationEnabled: true,
      stateCode: 0,
      stateDescription: 'Unknown',
      slots: {},
      rollbackIndices: {},
    };

    // Get all variables
    const getvarResult = await CommandExecutor.fastboot(deviceId, ['getvar', 'all']);

    // Parse output (fastboot getvar outputs to stderr)
    const output = getvarResult.stderr || getvarResult.stdout;
    const lines = output.split('\n');

    for (const line of lines) {
      const match = line.match(/\(bootloader\)\s*([^:]+):\s*(.+)/);
      if (!match) continue;

      const [, key, value] = match;
      const trimmedKey = key.trim().toLowerCase();
      const trimmedValue = value.trim();

      // Bootloader unlock state
      if (trimmedKey === 'unlocked') {
        result.unlocked = trimmedValue.toLowerCase() === 'yes';
      }

      // Slot information
      if (trimmedKey === 'slot-count') {
        result.slotCount = parseInt(trimmedValue, 10);
      }
      if (trimmedKey === 'current-slot') {
        result.currentSlot = trimmedValue.toLowerCase();
      }

      // AVB version
      if (trimmedKey.includes('avb') && trimmedKey.includes('version')) {
        result.avbVersion = trimmedValue;
      }

      // Vbmeta state per slot
      if (trimmedKey.startsWith('vbmeta-state')) {
        const slotMatch = trimmedKey.match(/vbmeta-state[-_]?([ab])?/);
        const slot = slotMatch?.[1] || 'default';
        result.slots[slot] = this.parseVbmetaState(trimmedValue);
      }

      // Rollback indices
      if (trimmedKey.includes('rollback')) {
        const indexMatch = trimmedKey.match(/(\d+)/);
        if (indexMatch) {
          result.rollbackIndices[indexMatch[1]] = parseInt(trimmedValue, 10);
        }
      }
    }

    // Determine overall state
    if (result.unlocked) {
      result.stateCode = 3;
      result.stateDescription = 'Bootloader unlocked - verification disabled';
      result.verityEnabled = false;
      result.verificationEnabled = false;
    } else {
      result.stateCode = 0;
      result.stateDescription = 'Bootloader locked - verification enabled';
    }

    return result;
  }

  /**
   * Get AVB state via ADB (requires root for some queries)
   */
  private static async getAVBStateFromADB(deviceId: string): Promise<AVBState> {
    const result: AVBState = {
      unlocked: false,
      verityEnabled: true,
      verificationEnabled: true,
      stateCode: 0,
      stateDescription: 'Unknown',
      slots: {},
      rollbackIndices: {},
    };

    // Check verified boot state from property
    const bootStateResult = await CommandExecutor.shell(
      deviceId,
      'getprop ro.boot.verifiedbootstate'
    );

    if (bootStateResult.success) {
      const state = bootStateResult.stdout.trim().toLowerCase();

      switch (state) {
        case 'green':
          result.stateCode = 0;
          result.stateDescription = 'Verified boot: GREEN (locked, verified)';
          result.verityEnabled = true;
          result.verificationEnabled = true;
          break;
        case 'yellow':
          result.stateCode = 1;
          result.stateDescription = 'Verified boot: YELLOW (locked, custom key)';
          result.verityEnabled = true;
          result.verificationEnabled = true;
          break;
        case 'orange':
          result.stateCode = 3;
          result.stateDescription = 'Verified boot: ORANGE (unlocked)';
          result.unlocked = true;
          result.verityEnabled = false;
          result.verificationEnabled = false;
          break;
        case 'red':
          result.stateCode = 2;
          result.stateDescription = 'Verified boot: RED (verification failed)';
          result.verityEnabled = true;
          result.verificationEnabled = false;
          break;
        default:
          result.stateDescription = `Verified boot state: ${state}`;
      }
    }

    // Check verity state
    const verityResult = await CommandExecutor.shell(
      deviceId,
      'getprop ro.boot.veritymode'
    );

    if (verityResult.success) {
      const verityMode = verityResult.stdout.trim().toLowerCase();
      result.verityEnabled = verityMode !== 'disabled' && verityMode !== '';
    }

    // Check flash lock state (may require root)
    const flashLockResult = await CommandExecutor.shell(
      deviceId,
      'getprop ro.boot.flash.locked'
    );

    if (flashLockResult.success) {
      const flashLocked = flashLockResult.stdout.trim();
      result.unlocked = flashLocked === '0';
    }

    // Get slot info
    const slotResult = await CommandExecutor.shell(
      deviceId,
      'getprop ro.boot.slot_suffix'
    );

    if (slotResult.success) {
      const slotSuffix = slotResult.stdout.trim();
      if (slotSuffix) {
        result.currentSlot = slotSuffix.replace('_', '');
        result.slotCount = 2; // A/B device
      }
    }

    return result;
  }

  /**
   * Parse vbmeta state string from fastboot
   */
  private static parseVbmetaState(stateStr: string): VerityState {
    const lower = stateStr.toLowerCase();

    if (lower.includes('disabled') || lower.includes('unlocked')) {
      return {
        verity: false,
        verification: false,
        raw: stateStr,
      };
    }

    if (lower.includes('enabled') || lower.includes('locked')) {
      return {
        verity: true,
        verification: true,
        raw: stateStr,
      };
    }

    // Try to parse numeric state
    const numMatch = stateStr.match(/(\d+)/);
    if (numMatch) {
      const code = parseInt(numMatch[1], 10);
      const state = AVB_STATES[code as keyof typeof AVB_STATES];
      if (state) {
        return {
          verity: state.verity,
          verification: state.verification,
          raw: stateStr,
        };
      }
    }

    return {
      verity: true,
      verification: true,
      raw: stateStr,
    };
  }

  /**
   * Check if device supports A/B slots
   */
  static async hasABSlots(deviceId: string, mode: string): Promise<boolean> {
    if (mode === 'bootloader') {
      const result = await CommandExecutor.fastboot(deviceId, ['getvar', 'slot-count']);
      const output = result.stderr || result.stdout;
      const match = output.match(/slot-count:\s*(\d+)/);
      return match ? parseInt(match[1], 10) >= 2 : false;
    }

    // ADB mode
    const result = await CommandExecutor.shell(deviceId, 'getprop ro.boot.slot_suffix');
    return result.success && result.stdout.trim() !== '';
  }

  /**
   * Get detailed slot information
   */
  static async getSlotInfo(deviceId: string, mode: string): Promise<{
    isAB: boolean;
    currentSlot?: string;
    slotA?: { bootable: boolean; successful: boolean; retryCount: number };
    slotB?: { bootable: boolean; successful: boolean; retryCount: number };
  }> {
    const info: {
      isAB: boolean;
      currentSlot?: string;
      slotA?: { bootable: boolean; successful: boolean; retryCount: number };
      slotB?: { bootable: boolean; successful: boolean; retryCount: number };
    } = { isAB: false };

    if (mode !== 'bootloader') {
      // In ADB mode, just check if A/B
      const slotResult = await CommandExecutor.shell(deviceId, 'getprop ro.boot.slot_suffix');
      if (slotResult.success && slotResult.stdout.trim()) {
        info.isAB = true;
        info.currentSlot = slotResult.stdout.trim().replace('_', '');
      }
      return info;
    }

    // Fastboot mode - get detailed slot info
    const result = await CommandExecutor.fastboot(deviceId, ['getvar', 'all']);
    const output = result.stderr || result.stdout;
    const lines = output.split('\n');

    const slotA = { bootable: false, successful: false, retryCount: 0 };
    const slotB = { bootable: false, successful: false, retryCount: 0 };

    for (const line of lines) {
      const match = line.match(/\(bootloader\)\s*([^:]+):\s*(.+)/);
      if (!match) continue;

      const [, key, value] = match;
      const trimmedKey = key.trim().toLowerCase();
      const trimmedValue = value.trim().toLowerCase();

      if (trimmedKey === 'slot-count') {
        const count = parseInt(trimmedValue, 10);
        info.isAB = count >= 2;
      }

      if (trimmedKey === 'current-slot') {
        info.currentSlot = trimmedValue;
      }

      // Slot A properties
      if (trimmedKey.includes('slot-bootable:a') || trimmedKey === 'slot-bootable_a') {
        slotA.bootable = trimmedValue === 'yes';
      }
      if (trimmedKey.includes('slot-successful:a') || trimmedKey === 'slot-successful_a') {
        slotA.successful = trimmedValue === 'yes';
      }
      if (trimmedKey.includes('slot-retry-count:a') || trimmedKey === 'slot-retry-count_a') {
        slotA.retryCount = parseInt(trimmedValue, 10) || 0;
      }

      // Slot B properties
      if (trimmedKey.includes('slot-bootable:b') || trimmedKey === 'slot-bootable_b') {
        slotB.bootable = trimmedValue === 'yes';
      }
      if (trimmedKey.includes('slot-successful:b') || trimmedKey === 'slot-successful_b') {
        slotB.successful = trimmedValue === 'yes';
      }
      if (trimmedKey.includes('slot-retry-count:b') || trimmedKey === 'slot-retry-count_b') {
        slotB.retryCount = parseInt(trimmedValue, 10) || 0;
      }
    }

    if (info.isAB) {
      info.slotA = slotA;
      info.slotB = slotB;
    }

    return info;
  }
}
