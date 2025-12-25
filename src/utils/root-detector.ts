/**
 * Root Solution Detector
 * Detects installed root solutions (Magisk, KernelSU, APatch, etc.)
 *
 * Based on PixelFlasher's root detection (phone.py:194-1200)
 */

import { CommandExecutor } from './executor.js';
import type { RootSolutionInfo, RootSolution } from '../types.js';

// Known root solution packages
const ROOT_PACKAGES: Record<RootSolution, string[]> = {
  magisk: [
    'com.topjohnwu.magisk',
    'io.github.huskydg.magisk', // Magisk Delta
    'io.github.vvb2060.magisk', // Alpha
  ],
  kernelsu: [
    'me.weishu.kernelsu',
  ],
  'kernelsu-next': [
    'me.weishu.kernelsu.next',
  ],
  apatch: [
    'me.bmax.apatch',
  ],
  'apatch-next': [
    'me.bmax.apatch.next',
  ],
  sukisu: [
    'io.github.sukisu',
  ],
  supersu: [
    'eu.chainfire.supersu',
    'com.koushikdutta.superuser',
  ],
  none: [],
};

// Root binary locations
const ROOT_BINARIES = {
  su: ['/system/bin/su', '/system/xbin/su', '/sbin/su'],
  magisk: ['/sbin/magisk', '/system/bin/magisk', '/data/adb/magisk/magisk'],
  ksu: ['/data/adb/ksu/bin/ksud', '/data/adb/ksud'],
  apatch: ['/data/adb/apatch/apd'],
};

export class RootDetector {
  /**
   * Detect all installed root solutions
   */
  static async detectRootSolutions(deviceId: string): Promise<RootSolutionInfo[]> {
    const solutions: RootSolutionInfo[] = [];

    // Check each root solution in parallel
    const checks = await Promise.all([
      this.detectMagisk(deviceId),
      this.detectKernelSU(deviceId),
      this.detectAPatch(deviceId),
      this.detectSuperSU(deviceId),
      this.detectGenericRoot(deviceId),
    ]);

    for (const check of checks) {
      if (check && check.installed) {
        solutions.push(check);
      }
    }

    return solutions;
  }

  /**
   * Get primary root solution (highest priority installed)
   */
  static async getPrimaryRootSolution(deviceId: string): Promise<RootSolutionInfo | null> {
    const solutions = await this.detectRootSolutions(deviceId);

    if (solutions.length === 0) {
      return null;
    }

    // Priority: APatch > KernelSU > Magisk > SuperSU > Generic
    const priority: RootSolution[] = [
      'apatch', 'apatch-next',
      'kernelsu', 'kernelsu-next', 'sukisu',
      'magisk',
      'supersu',
      'none',
    ];

    solutions.sort((a, b) => {
      const aIndex = priority.indexOf(a.solution);
      const bIndex = priority.indexOf(b.solution);
      return aIndex - bIndex;
    });

    return solutions[0];
  }

  /**
   * Detect Magisk installation
   */
  private static async detectMagisk(deviceId: string): Promise<RootSolutionInfo | null> {
    const info: RootSolutionInfo = {
      solution: 'magisk',
      installed: false,
      version: null,
      versionCode: null,
      appVersion: null,
      packageName: null,
      features: [],
    };

    // Check for Magisk app
    for (const pkg of ROOT_PACKAGES.magisk) {
      // Use grep -F for literal string match (prevents injection)
      const pkgCheck = await CommandExecutor.shell(
        deviceId,
        `pm list packages 2>/dev/null | grep -F '${pkg.replace(/'/g, "'\\''")}'`
      );

      if (pkgCheck.success && pkgCheck.stdout.includes(pkg)) {
        info.installed = true;
        info.packageName = pkg;

        // Get app version
        const versionResult = await CommandExecutor.shell(
          deviceId,
          `dumpsys package ${pkg} | grep versionName`
        );

        if (versionResult.success) {
          const match = versionResult.stdout.match(/versionName=([^\s]+)/);
          if (match) {
            info.appVersion = match[1];
          }
        }

        break;
      }
    }

    // Check for Magisk binary
    const magiskBinaryCheck = await CommandExecutor.shell(
      deviceId,
      'su -c "magisk -v" 2>/dev/null || echo ""'
    );

    if (magiskBinaryCheck.success && magiskBinaryCheck.stdout.trim()) {
      info.installed = true;
      const version = magiskBinaryCheck.stdout.trim();
      // Extract version (format: "v26.4:MAGISK:R" or similar)
      const versionMatch = version.match(/^v?(\d+\.?\d*)/);
      if (versionMatch) {
        info.version = versionMatch[1];
      } else {
        info.version = version.split(':')[0].replace('v', '');
      }
    }

    // Get version code
    const versionCodeCheck = await CommandExecutor.shell(
      deviceId,
      'su -c "magisk -V" 2>/dev/null || echo ""'
    );

    if (versionCodeCheck.success && versionCodeCheck.stdout.trim()) {
      const code = parseInt(versionCodeCheck.stdout.trim(), 10);
      if (!isNaN(code)) {
        info.versionCode = code;
      }
    }

    // Check Magisk features
    if (info.installed) {
      // Check Zygisk
      const zygiskCheck = await CommandExecutor.shell(
        deviceId,
        'su -c "cat /data/adb/magisk/config" 2>/dev/null || echo ""'
      );

      if (zygiskCheck.success && zygiskCheck.stdout.includes('ZYGISK=1')) {
        info.features.push('zygisk');
      }

      // Check Denylist
      const denylistCheck = await CommandExecutor.shell(
        deviceId,
        'su -c "magisk --denylist status" 2>/dev/null'
      );

      if (denylistCheck.success && denylistCheck.stdout.includes('enabled')) {
        info.features.push('denylist');
      }
    }

    return info.installed ? info : null;
  }

  /**
   * Detect KernelSU installation
   */
  private static async detectKernelSU(deviceId: string): Promise<RootSolutionInfo | null> {
    const info: RootSolutionInfo = {
      solution: 'kernelsu',
      installed: false,
      version: null,
      versionCode: null,
      appVersion: null,
      packageName: null,
      features: [],
    };

    // Check for KernelSU app
    for (const pkg of [...ROOT_PACKAGES.kernelsu, ...ROOT_PACKAGES['kernelsu-next']]) {
      // Use grep -F for literal string match (prevents injection)
      const pkgCheck = await CommandExecutor.shell(
        deviceId,
        `pm list packages 2>/dev/null | grep -F '${pkg.replace(/'/g, "'\\''")}'`
      );

      if (pkgCheck.success && pkgCheck.stdout.includes(pkg)) {
        info.installed = true;
        info.packageName = pkg;

        if (pkg.includes('next')) {
          info.solution = 'kernelsu-next';
        }

        // Get app version
        const versionResult = await CommandExecutor.shell(
          deviceId,
          `dumpsys package ${pkg} | grep versionName`
        );

        if (versionResult.success) {
          const match = versionResult.stdout.match(/versionName=([^\s]+)/);
          if (match) {
            info.appVersion = match[1];
          }
        }

        break;
      }
    }

    // Check for KernelSU kernel module
    const ksuCheck = await CommandExecutor.shell(
      deviceId,
      'su -c "cat /proc/version" 2>/dev/null || cat /proc/version'
    );

    if (ksuCheck.success && ksuCheck.stdout.toLowerCase().includes('ksu')) {
      info.installed = true;
      info.features.push('kernel-integrated');
    }

    // Check for ksud binary
    const ksudCheck = await CommandExecutor.shell(
      deviceId,
      'su -c "ksud -V" 2>/dev/null || echo ""'
    );

    if (ksudCheck.success && ksudCheck.stdout.trim()) {
      info.installed = true;
      info.version = ksudCheck.stdout.trim();
    }

    return info.installed ? info : null;
  }

  /**
   * Detect APatch installation
   */
  private static async detectAPatch(deviceId: string): Promise<RootSolutionInfo | null> {
    const info: RootSolutionInfo = {
      solution: 'apatch',
      installed: false,
      version: null,
      versionCode: null,
      appVersion: null,
      packageName: null,
      features: [],
    };

    // Check for APatch app
    for (const pkg of [...ROOT_PACKAGES.apatch, ...ROOT_PACKAGES['apatch-next']]) {
      // Use grep -F for literal string match (prevents injection)
      const pkgCheck = await CommandExecutor.shell(
        deviceId,
        `pm list packages 2>/dev/null | grep -F '${pkg.replace(/'/g, "'\\''")}'`
      );

      if (pkgCheck.success && pkgCheck.stdout.includes(pkg)) {
        info.installed = true;
        info.packageName = pkg;

        if (pkg.includes('next')) {
          info.solution = 'apatch-next';
        }

        // Get app version
        const versionResult = await CommandExecutor.shell(
          deviceId,
          `dumpsys package ${pkg} | grep versionName`
        );

        if (versionResult.success) {
          const match = versionResult.stdout.match(/versionName=([^\s]+)/);
          if (match) {
            info.appVersion = match[1];
          }
        }

        break;
      }
    }

    // Check for APatch binary
    const apdCheck = await CommandExecutor.shell(
      deviceId,
      'su -c "apd -V" 2>/dev/null || echo ""'
    );

    if (apdCheck.success && apdCheck.stdout.trim()) {
      info.installed = true;
      info.version = apdCheck.stdout.trim();
    }

    return info.installed ? info : null;
  }

  /**
   * Detect SuperSU installation (legacy)
   */
  private static async detectSuperSU(deviceId: string): Promise<RootSolutionInfo | null> {
    const info: RootSolutionInfo = {
      solution: 'supersu',
      installed: false,
      version: null,
      versionCode: null,
      appVersion: null,
      packageName: null,
      features: [],
    };

    // Check for SuperSU app
    for (const pkg of ROOT_PACKAGES.supersu) {
      // Use grep -F for literal string match (prevents injection)
      const pkgCheck = await CommandExecutor.shell(
        deviceId,
        `pm list packages 2>/dev/null | grep -F '${pkg.replace(/'/g, "'\\''")}'`
      );

      if (pkgCheck.success && pkgCheck.stdout.includes(pkg)) {
        info.installed = true;
        info.packageName = pkg;

        // Get app version
        const versionResult = await CommandExecutor.shell(
          deviceId,
          `dumpsys package ${pkg} | grep versionName`
        );

        if (versionResult.success) {
          const match = versionResult.stdout.match(/versionName=([^\s]+)/);
          if (match) {
            info.appVersion = match[1];
          }
        }

        break;
      }
    }

    return info.installed ? info : null;
  }

  /**
   * Detect generic root (su binary without known manager)
   */
  private static async detectGenericRoot(deviceId: string): Promise<RootSolutionInfo | null> {
    const info: RootSolutionInfo = {
      solution: 'none',
      installed: false,
      version: null,
      versionCode: null,
      appVersion: null,
      packageName: null,
      features: [],
    };

    // Check if su command works
    const suCheck = await CommandExecutor.shell(deviceId, 'su -c id 2>/dev/null');

    if (suCheck.success && suCheck.stdout.includes('uid=0')) {
      info.installed = true;
      info.features.push('generic-su');
    }

    // Check for su binary locations
    for (const suPath of ROOT_BINARIES.su) {
      // Quote path to prevent injection
      const exists = await CommandExecutor.shell(
        deviceId,
        `ls '${suPath}' 2>/dev/null`
      );

      if (exists.success && exists.stdout.includes(suPath)) {
        info.installed = true;
        info.features.push(`su-at-${suPath.replace(/\//g, '-')}`);
        break;
      }
    }

    // Return as generic root if su works but no specific solution detected
    return info.installed ? info : null;
  }

  /**
   * Check if device has any root access
   */
  static async hasRootAccess(deviceId: string): Promise<boolean> {
    const suCheck = await CommandExecutor.shell(deviceId, 'su -c id 2>/dev/null');
    return suCheck.success && suCheck.stdout.includes('uid=0');
  }

  /**
   * Get brief root status summary
   */
  static async getRootSummary(deviceId: string): Promise<{
    isRooted: boolean;
    primarySolution: RootSolution | null;
    version: string | null;
    features: string[];
  }> {
    const primary = await this.getPrimaryRootSolution(deviceId);

    if (!primary) {
      return {
        isRooted: false,
        primarySolution: null,
        version: null,
        features: [],
      };
    }

    return {
      isRooted: true,
      primarySolution: primary.solution,
      version: primary.version || primary.appVersion,
      features: primary.features,
    };
  }
}
