/**
 * Screen & interaction tools for UI automation and visual debugging
 */

import { z } from 'zod';
import { DeviceManager } from '../utils/device-manager.js';
import { CommandExecutor } from '../utils/executor.js';
import { ResponseFormatter, formatBytes } from '../utils/formatter.js';
import { SafetyValidator } from '../utils/validator.js';
import { ErrorHandler } from '../utils/error-handler.js';
import { CONFIG } from '../config.js';
import type { ScreenInfo, Screenshot, Recording } from '../types.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Schemas
export const CaptureScreenshotSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  output_path: z.string().optional().describe('Local output path for screenshot (default: temp dir with timestamp)'),
  return_base64: z.boolean().default(false).describe('Return base64-encoded image data for AI analysis'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const GetScreenInfoSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  format: z.enum(['markdown', 'json']).default('markdown')
}).strict();

export const InputTapSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  x: z.number().int().min(0).describe('X coordinate (pixels from left)'),
  y: z.number().int().min(0).describe('Y coordinate (pixels from top)')
}).strict();

export const InputSwipeSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  x1: z.number().int().min(0).describe('Start X coordinate'),
  y1: z.number().int().min(0).describe('Start Y coordinate'),
  x2: z.number().int().min(0).describe('End X coordinate'),
  y2: z.number().int().min(0).describe('End Y coordinate'),
  duration_ms: z.number().int().min(1).default(300).describe('Swipe duration in milliseconds (default: 300)')
}).strict();

export const InputTextSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  text: z.string().optional().describe('Text to type (one of text or keycode required)'),
  keycode: z.string().optional().describe('Keycode to send: HOME, BACK, ENTER, VOLUME_UP, etc. (one of text or keycode required)')
}).strict();

export const RecordScreenSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  duration_seconds: z.number().int().min(1).max(180).describe('Recording duration in seconds (max: 180)'),
  output_path: z.string().describe('Local output path for video file (.mp4)'),
  bit_rate: z.string().default('4M').describe('Bit rate (e.g., "4M", "8M", "12M") - default: 4M')
}).strict();

// Tool implementations
export const interactionTools = {
  capture_screenshot: {
    description: `Capture device screen as PNG image.

This tool takes a screenshot of the current device screen state. Useful for:
- AI visual analysis and debugging
- Verifying UI state before/after actions
- Documenting device state
- Bug reporting and troubleshooting

Options:
- **output_path**: Save to specific location (default: temp dir with timestamp)
- **return_base64**: Include base64-encoded image for direct AI analysis (default: false)

⚠️ **Note**: Screenshots may capture sensitive information. Screen must be on.

Requires: Android device in ADB mode, screen on

Examples:
- capture_screenshot(device_id="ABC123") → Save to temp dir
- capture_screenshot(device_id="ABC123", output_path="/screenshots/state.png") → Save to specific path
- capture_screenshot(device_id="ABC123", return_base64=true) → Get base64 data for AI analysis`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        output_path: {
          type: 'string' as const,
          description: 'Local output path for screenshot (default: temp dir with timestamp)'
        },
        return_base64: {
          type: 'boolean' as const,
          default: false,
          description: 'Return base64-encoded image data for AI analysis'
        },
        format: {
          type: 'string' as const,
          enum: ['markdown', 'json'],
          default: 'markdown'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof CaptureScreenshotSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.requireMode(args.device_id, 'device');

        // Generate output path if not provided
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputPath = args.output_path || path.join(os.tmpdir(), `screenshot_${timestamp}.png`);

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        const tempPath = `/sdcard/screenshot_${Date.now()}.png`;

        try {
          // Capture screenshot on device
          const captureResult = await CommandExecutor.shell(
            args.device_id,
            `screencap -p ${tempPath}`
          );

          if (!captureResult.success) {
            throw new Error(
              `Failed to capture screenshot: ${captureResult.stderr}\n\n` +
              `Possible causes:\n` +
              `- Screen is off or locked\n` +
              `- Insufficient storage on device\n` +
              `- Permission issues`
            );
          }

          // Pull screenshot to PC
          const pullResult = await CommandExecutor.adb(args.device_id, [
            'pull',
            tempPath,
            outputPath
          ]);

          if (!pullResult.success) {
            throw new Error(`Failed to retrieve screenshot: ${pullResult.stderr}`);
          }

          // Get file size
          const stats = fs.statSync(outputPath);
          const sizeBytes = stats.size;

          // Build result object
          const screenshot: Screenshot = {
            path: outputPath,
            sizeBytes,
            timestamp: new Date().toISOString()
          };

          // Optionally encode to base64
          if (args.return_base64) {
            const imageBuffer = fs.readFileSync(outputPath);
            screenshot.base64 = imageBuffer.toString('base64');
          }

          // Cleanup temp file on device
          await CommandExecutor.shell(args.device_id, `rm ${tempPath}`).catch(() => {
            // Ignore cleanup errors
          });

          if (args.format === 'json') {
            return JSON.stringify(screenshot, null, 2);
          }

          let result = `# Screenshot Captured\n\n`;
          result += `**Path**: ${screenshot.path}\n`;
          result += `**Size**: ${formatBytes(screenshot.sizeBytes)}\n`;
          result += `**Timestamp**: ${screenshot.timestamp}\n`;

          if (screenshot.base64) {
            result += `**Base64 Length**: ${screenshot.base64.length} characters\n`;
            result += `\n*Base64 data available in JSON format response*`;
          }

          return result;

        } catch (error) {
          // Cleanup on error
          await CommandExecutor.shell(args.device_id, `rm ${tempPath}`).catch(() => {});
          throw error;
        }
      });
    }
  },

  get_screen_info: {
    description: `Get device screen information.

Returns comprehensive screen details:
- Resolution (width x height in pixels)
- Density (scale factor and DPI)
- Orientation (portrait/landscape)
- Rotation (0°, 90°, 180°, 270°)

Useful for:
- Planning touch coordinates for input_tap and input_swipe
- Responsive UI automation
- Understanding device display characteristics
- Calculating relative positions

Requires: Android device in ADB mode

Examples:
- get_screen_info(device_id="ABC123") → Get all screen details
- get_screen_info(device_id="ABC123", format="json") → Structured data for automation`,
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
    handler: async (args: z.infer<typeof GetScreenInfoSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.requireMode(args.device_id, 'device');

        // Get screen size
        const sizeResult = await CommandExecutor.shell(args.device_id, 'wm size');
        if (!sizeResult.success) {
          throw new Error(`Failed to get screen size: ${sizeResult.stderr}`);
        }

        // Parse: "Physical size: 1080x2400" or "Override size: 1080x2400"
        const sizeMatch = sizeResult.stdout.match(/(\d+)x(\d+)/);
        if (!sizeMatch) {
          throw new Error(`Failed to parse screen size from: ${sizeResult.stdout}`);
        }

        const width = parseInt(sizeMatch[1], 10);
        const height = parseInt(sizeMatch[2], 10);

        // Get screen density
        const densityResult = await CommandExecutor.shell(args.device_id, 'wm density');
        if (!densityResult.success) {
          throw new Error(`Failed to get screen density: ${densityResult.stderr}`);
        }

        // Parse: "Physical density: 440" or "Override density: 440"
        const densityMatch = densityResult.stdout.match(/density:\s*(\d+)/);
        const densityDpi = densityMatch ? parseInt(densityMatch[1], 10) : 0;
        const density = densityDpi / 160; // Convert to scale factor

        // Determine orientation based on dimensions
        const orientation: 'portrait' | 'landscape' = height > width ? 'portrait' : 'landscape';

        // Try to get rotation (0, 90, 180, 270)
        let rotation: 0 | 90 | 180 | 270 = 0;
        const rotationResult = await CommandExecutor.shell(
          args.device_id,
          'dumpsys input | grep SurfaceOrientation'
        );
        if (rotationResult.success) {
          const rotationMatch = rotationResult.stdout.match(/SurfaceOrientation:\s*(\d+)/);
          if (rotationMatch) {
            const rotValue = parseInt(rotationMatch[1], 10);
            rotation = [0, 90, 180, 270][rotValue] as 0 | 90 | 180 | 270 || 0;
          }
        }

        const screenInfo: ScreenInfo = {
          width,
          height,
          density,
          densityDpi,
          orientation,
          rotation
        };

        if (args.format === 'json') {
          return JSON.stringify(screenInfo, null, 2);
        }

        let result = `# Screen Information\n\n`;
        result += `**Resolution**: ${width} x ${height} pixels\n`;
        result += `**Density**: ${density.toFixed(2)}x (${densityDpi} DPI)\n`;
        result += `**Orientation**: ${orientation}\n`;
        result += `**Rotation**: ${rotation}°\n`;
        result += `\n**Aspect Ratio**: ${(width / height).toFixed(2)}:1\n`;
        result += `**Total Pixels**: ${(width * height / 1_000_000).toFixed(1)}M\n`;

        return result;
      });
    }
  },

  input_tap: {
    description: `Simulate tap at specific screen coordinates.

Sends a touch tap event at the specified (x, y) coordinates. The tap occurs at the exact pixel position specified.

Coordinate system:
- Origin (0, 0) is at top-left corner
- X increases to the right
- Y increases downward
- Use get_screen_info() to determine screen dimensions

Safety: Non-destructive, no confirmation required

Requires: Android device in ADB mode, screen unlocked

Examples:
- input_tap(device_id="ABC123", x=540, y=1200) → Tap center of 1080x2400 screen
- input_tap(device_id="ABC123", x=100, y=100) → Tap near top-left
- input_tap(device_id="ABC123", x=960, y=540) → Tap specific button location`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        x: {
          type: 'number' as const,
          description: 'X coordinate (pixels from left)'
        },
        y: {
          type: 'number' as const,
          description: 'Y coordinate (pixels from top)'
        }
      },
      required: ['device_id', 'x', 'y']
    },
    handler: async (args: z.infer<typeof InputTapSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.requireMode(args.device_id, 'device');

        // Validate coordinates
        SafetyValidator.validateCoordinates(args.x, args.y);

        // Execute tap
        const result = await CommandExecutor.shell(
          args.device_id,
          `input tap ${args.x} ${args.y}`
        );

        if (!result.success) {
          throw new Error(
            `Failed to execute tap: ${result.stderr}\n\n` +
            `Possible causes:\n` +
            `- Screen is locked\n` +
            `- Coordinates out of bounds\n` +
            `- Input service not available`
          );
        }

        return ResponseFormatter.success(
          `Tap executed at (${args.x}, ${args.y})`,
          {
            coordinates: `(${args.x}, ${args.y})`,
            note: 'Tap completed successfully'
          }
        );
      });
    }
  },

  input_swipe: {
    description: `Simulate swipe gesture between two points.

Sends a touch swipe gesture from (x1, y1) to (x2, y2) over the specified duration. Useful for:
- Scrolling (swipe up/down)
- Navigation (swipe left/right)
- Unlocking device (swipe up from bottom)
- Dismissing notifications
- Page turning

Coordinate system: Same as input_tap (0,0 = top-left)

Duration affects swipe speed:
- Fast swipe: 100-200ms
- Normal swipe: 300-500ms (default: 300ms)
- Slow swipe: 1000ms+

Safety: Non-destructive, no confirmation required

Requires: Android device in ADB mode

Examples:
- input_swipe(device_id="ABC123", x1=540, y1=2000, x2=540, y2=800) → Swipe up (unlock/scroll)
- input_swipe(device_id="ABC123", x1=900, y1=1200, x2=180, y2=1200) → Swipe left
- input_swipe(device_id="ABC123", x1=540, y1=800, x2=540, y2=2000, duration_ms=500) → Slow swipe down`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        x1: {
          type: 'number' as const,
          description: 'Start X coordinate'
        },
        y1: {
          type: 'number' as const,
          description: 'Start Y coordinate'
        },
        x2: {
          type: 'number' as const,
          description: 'End X coordinate'
        },
        y2: {
          type: 'number' as const,
          description: 'End Y coordinate'
        },
        duration_ms: {
          type: 'number' as const,
          default: 300,
          description: 'Swipe duration in milliseconds (default: 300)'
        }
      },
      required: ['device_id', 'x1', 'y1', 'x2', 'y2']
    },
    handler: async (args: z.infer<typeof InputSwipeSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.requireMode(args.device_id, 'device');

        // Validate all coordinates
        SafetyValidator.validateCoordinates(args.x1, args.y1);
        SafetyValidator.validateCoordinates(args.x2, args.y2);

        // Validate duration
        if (args.duration_ms < 1) {
          throw new Error('Duration must be at least 1ms');
        }

        // Execute swipe
        const result = await CommandExecutor.shell(
          args.device_id,
          `input swipe ${args.x1} ${args.y1} ${args.x2} ${args.y2} ${args.duration_ms}`
        );

        if (!result.success) {
          throw new Error(
            `Failed to execute swipe: ${result.stderr}\n\n` +
            `Possible causes:\n` +
            `- Screen is locked\n` +
            `- Coordinates out of bounds\n` +
            `- Input service not available`
          );
        }

        // Calculate swipe direction and distance
        const deltaX = args.x2 - args.x1;
        const deltaY = args.y2 - args.y1;
        const distance = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
        
        let direction = 'custom';
        if (Math.abs(deltaY) > Math.abs(deltaX) * 2) {
          direction = deltaY < 0 ? 'up' : 'down';
        } else if (Math.abs(deltaX) > Math.abs(deltaY) * 2) {
          direction = deltaX < 0 ? 'left' : 'right';
        }

        return ResponseFormatter.success(
          `Swipe executed from (${args.x1}, ${args.y1}) to (${args.x2}, ${args.y2})`,
          {
            direction,
            distance: `${Math.round(distance)} pixels`,
            duration: `${args.duration_ms}ms`,
            note: 'Swipe completed successfully'
          }
        );
      });
    }
  },

  input_text: {
    description: `Type text or send key events to device.

Two modes:
1. **Text mode**: Type literal text (letters, numbers, symbols)
2. **Keycode mode**: Send special key events (HOME, BACK, ENTER, etc.)

Text mode:
- Automatically escapes special characters
- Spaces are converted to %s (Android requirement)
- Useful for entering text in fields

Keycode mode:
- Send hardware/software button presses
- Common keycodes: HOME, BACK, ENTER, VOLUME_UP, VOLUME_DOWN, POWER, MENU, etc.
- See full list in error message if invalid keycode provided

⚠️ **Note**: Provide either 'text' OR 'keycode', not both.

Safety: Non-destructive, no confirmation required

Requires: Android device in ADB mode

Examples:
- input_text(device_id="ABC123", text="Hello World") → Type text
- input_text(device_id="ABC123", text="my_password123") → Type password
- input_text(device_id="ABC123", keycode="ENTER") → Press Enter
- input_text(device_id="ABC123", keycode="HOME") → Press Home button
- input_text(device_id="ABC123", keycode="BACK") → Press Back button
- input_text(device_id="ABC123", keycode="VOLUME_UP") → Press Volume Up`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        text: {
          type: 'string' as const,
          description: 'Text to type (one of text or keycode required)'
        },
        keycode: {
          type: 'string' as const,
          description: 'Keycode to send: HOME, BACK, ENTER, VOLUME_UP, etc. (one of text or keycode required)'
        }
      },
      required: ['device_id']
    },
    handler: async (args: z.infer<typeof InputTextSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.requireMode(args.device_id, 'device');

        // Validate that either text or keycode is provided
        if (!args.text && !args.keycode) {
          throw new Error('Either "text" or "keycode" must be provided');
        }

        if (args.text && args.keycode) {
          throw new Error('Provide either "text" or "keycode", not both');
        }

        let result;
        let action = '';

        if (args.text) {
          // Text mode: escape and send text
          const escapedText = SafetyValidator.escapeShellText(args.text);
          result = await CommandExecutor.shell(
            args.device_id,
            `input text "${escapedText}"`
          );
          action = `Typed text: "${args.text}"`;

        } else if (args.keycode) {
          // Keycode mode: validate and send keycode
          const keycodeNumber = SafetyValidator.validateKeycode(args.keycode);
          result = await CommandExecutor.shell(
            args.device_id,
            `input keyevent ${keycodeNumber}`
          );
          action = `Sent keycode: ${args.keycode.toUpperCase()} (${keycodeNumber})`;
        }

        if (result && !result.success) {
          throw new Error(
            `Failed to send input: ${result.stderr}\n\n` +
            `Possible causes:\n` +
            `- Screen is locked\n` +
            `- Input service not available\n` +
            `- Text contains unsupported characters`
          );
        }

        return ResponseFormatter.success(action, {
          note: 'Input sent successfully'
        });
      });
    }
  },

  record_screen: {
    description: `Record device screen to video file.

Records device screen activity to MP4 video file. Useful for:
- Documenting bugs and issues
- Creating tutorials and demonstrations
- Capturing UI interactions
- Testing animations and transitions

Features:
- Records video and audio (if available)
- Configurable bit rate for quality/size trade-off
- Maximum duration: 180 seconds (Android limitation)
- Output format: MP4 (H.264/AAC)

⚠️ **Note**: This is a blocking operation - it waits for recording to complete.

Requires: 
- Android 4.4+ (API 19)
- Device in ADB mode
- Screen on during recording

Examples:
- record_screen(device_id="ABC123", duration_seconds=10, output_path="/videos/demo.mp4") → 10-second recording
- record_screen(device_id="ABC123", duration_seconds=30, output_path="/videos/bug.mp4", bit_rate="8M") → High quality
- record_screen(device_id="ABC123", duration_seconds=5, output_path="/videos/quick.mp4", bit_rate="2M") → Low quality`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        duration_seconds: {
          type: 'number' as const,
          description: 'Recording duration in seconds (max: 180)'
        },
        output_path: {
          type: 'string' as const,
          description: 'Local output path for video file (.mp4)'
        },
        bit_rate: {
          type: 'string' as const,
          default: '4M',
          description: 'Bit rate (e.g., "4M", "8M", "12M") - default: 4M'
        }
      },
      required: ['device_id', 'duration_seconds', 'output_path']
    },
    handler: async (args: z.infer<typeof RecordScreenSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.requireMode(args.device_id, 'device');

        // Validate duration
        if (args.duration_seconds > CONFIG.MAX_RECORDING_DURATION) {
          throw new Error(
            `Maximum recording duration is ${CONFIG.MAX_RECORDING_DURATION} seconds (Android limitation). ` +
            `Requested: ${args.duration_seconds} seconds`
          );
        }

        // Ensure output directory exists
        const outputDir = path.dirname(args.output_path);
        if (!fs.existsSync(outputDir)) {
          fs.mkdirSync(outputDir, { recursive: true });
        }

        // Ensure .mp4 extension
        let outputPath = args.output_path;
        if (!outputPath.toLowerCase().endsWith('.mp4')) {
          outputPath += '.mp4';
        }

        const tempPath = `/sdcard/recording_${Date.now()}.mp4`;
        const startTime = Date.now();

        try {
          // Start recording (blocking operation)
          const recordResult = await CommandExecutor.shell(
            args.device_id,
            `screenrecord --time-limit ${args.duration_seconds} --bit-rate ${args.bit_rate} ${tempPath}`
          );

          if (!recordResult.success) {
            throw new Error(
              `Failed to record screen: ${recordResult.stderr}\n\n` +
              `Possible causes:\n` +
              `- Device does not support screen recording (requires Android 4.4+)\n` +
              `- Screen is off\n` +
              `- Insufficient storage on device\n` +
              `- Invalid bit rate format`
            );
          }

          // Pull video to PC
          const pullResult = await CommandExecutor.adb(args.device_id, [
            'pull',
            tempPath,
            outputPath
          ]);

          if (!pullResult.success) {
            throw new Error(`Failed to retrieve recording: ${pullResult.stderr}`);
          }

          // Get file size
          const stats = fs.statSync(outputPath);
          const sizeBytes = stats.size;
          const durationMs = Date.now() - startTime;

          const recording: Recording = {
            path: outputPath,
            sizeBytes,
            durationSeconds: args.duration_seconds,
            bitRate: args.bit_rate,
            timestamp: new Date().toISOString()
          };

          // Cleanup temp file on device
          await CommandExecutor.shell(args.device_id, `rm ${tempPath}`).catch(() => {
            // Ignore cleanup errors
          });

          let result = `# Screen Recording Complete\n\n`;
          result += `**Path**: ${recording.path}\n`;
          result += `**Size**: ${formatBytes(recording.sizeBytes)}\n`;
          result += `**Duration**: ${recording.durationSeconds} seconds\n`;
          result += `**Bit Rate**: ${recording.bitRate}\n`;
          result += `**Actual Time**: ${Math.round(durationMs / 1000)} seconds\n`;
          result += `**Timestamp**: ${recording.timestamp}\n`;
          result += `\n✅ Recording saved successfully`;

          return result;

        } catch (error) {
          // Cleanup on error
          await CommandExecutor.shell(args.device_id, `rm ${tempPath}`).catch(() => {});
          throw error;
        }
      });
    }
  }
};

