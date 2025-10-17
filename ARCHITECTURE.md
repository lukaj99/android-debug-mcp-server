# Android Debug MCP Server - Architecture Documentation

## 📋 Table of Contents

1. [Overview](#overview)
2. [System Architecture](#system-architecture)
3. [Core Components](#core-components)
4. [Data Flow](#data-flow)
5. [Module Structure](#module-structure)
6. [Tool Categories](#tool-categories)
7. [Security & Safety](#security--safety)
8. [Error Handling](#error-handling)
9. [Extension Guide](#extension-guide)

---

## Overview

The Android Debug MCP Server is a Model Context Protocol (MCP) server that provides AI assistants with comprehensive access to Android device debugging capabilities. It exposes 27 tools across 4 categories, enabling device management, app operations, file transfers, and system flashing operations.

### Key Characteristics

- **Protocol**: MCP (Model Context Protocol) v1.0
- **Transport**: stdio (Standard Input/Output)
- **Runtime**: Node.js 18+
- **Language**: TypeScript (ES2022 modules)
- **Build System**: TypeScript Compiler (tsc)

---

## System Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AI Assistant                            │
│                    (Claude Desktop)                          │
└──────────────────────┬──────────────────────────────────────┘
                       │ stdio (MCP Protocol)
                       │
┌──────────────────────▼──────────────────────────────────────┐
│                   MCP Server Layer                           │
│  ┌────────────────────────────────────────────────────────┐ │
│  │  index.ts - Entry Point & Server Initialization       │ │
│  └────────────────────┬───────────────────────────────────┘ │
│                       │                                      │
│  ┌────────────────────▼───────────────────────────────────┐ │
│  │  server.ts - Tool Registration & Request Routing      │ │
│  │  - ListToolsRequestSchema handler                     │ │
│  │  - CallToolRequestSchema handler                      │ │
│  └────────────────────┬───────────────────────────────────┘ │
└───────────────────────┼──────────────────────────────────────┘
                        │
         ┌──────────────┼──────────────┐
         │              │              │
    ┌────▼────┐    ┌───▼────┐    ┌───▼────┐    ┌────────┐
    │ Device  │    │  App   │    │  File  │    │ Flash  │
    │ Tools   │    │ Tools  │    │ Tools  │    │ Tools  │
    └────┬────┘    └───┬────┘    └───┬────┘    └────┬───┘
         │             │              │              │
         └──────┬──────┴──────┬───────┴──────────────┘
                │             │
    ┌───────────▼─────────────▼───────────────────────────┐
    │              Utility Layer                          │
    │  ┌──────────┐  ┌──────────┐  ┌──────────────────┐  │
    │  │Validator │  │Formatter │  │  Error Handler   │  │
    │  └──────────┘  └──────────┘  └──────────────────┘  │
    │  ┌──────────┐  ┌──────────────────────────────┐    │
    │  │ Executor │  │    Device Manager            │    │
    │  └──────────┘  └──────────────────────────────┘    │
    └───────────┬─────────────────────────────────────────┘
                │
    ┌───────────▼──────────────────────────────────────────┐
    │         Android Platform Tools Layer                 │
    │  ┌────────────────────┐  ┌────────────────────────┐  │
    │  │   ADB (adb)        │  │  Fastboot (fastboot)   │  │
    │  └────────────────────┘  └────────────────────────┘  │
    └───────────┬──────────────────────────────────────────┘
                │
    ┌───────────▼──────────────────────────────────────────┐
    │              Connected Android Devices               │
    │     (USB/Wireless: device, bootloader, recovery)     │
    └──────────────────────────────────────────────────────┘
```

---

## Core Components

### 1. Entry Point (`src/index.ts`)

**Purpose**: Application initialization and error handling

**Responsibilities**:
- Start the MCP server
- Handle top-level errors
- Graceful shutdown

```typescript
startServer().catch((error) => {
  console.error('Failed to start server:', error);
  process.exit(1);
});
```

### 2. Server Layer (`src/server.ts`)

**Purpose**: MCP protocol implementation and tool orchestration

**Responsibilities**:
- Create and configure MCP server instance
- Register all tools from 4 categories
- Route tool call requests to appropriate handlers
- Format responses according to MCP spec
- Handle errors and return formatted error responses

**Key Functions**:
- `createServer()`: Initializes server with tool registration
- `startServer()`: Connects transport and starts listening

### 3. Configuration (`src/config.ts`)

**Purpose**: Centralized configuration and error messages

**Key Constants**:
```typescript
CONFIG = {
  ADB_PATH: 'adb',              // Configurable via env
  FASTBOOT_PATH: 'fastboot',     // Configurable via env
  COMMAND_TIMEOUT: 30000,        // 30 second timeout
  CHARACTER_LIMIT: 25000,        // Response size limit
  MAX_LOG_LINES: 1000           // Logcat line limit
}
```

### 4. Type System (`src/types.ts`)

**Purpose**: TypeScript type definitions for type safety

**Key Types**:
- `Device`: Device identification and mode
- `DeviceInfo`: Comprehensive device information
- `Package`: Android app/package metadata
- `FileInfo`: File system information
- `CommandResult`: Command execution result
- `PartitionInfo`: Device partition data

---

## Data Flow

### Tool Call Lifecycle

```
1. AI Assistant → MCP Request
   ↓
2. server.ts receives CallToolRequest
   ↓
3. Extract tool name and arguments
   ↓
4. Route to appropriate tool handler (device/app/file/flash)
   ↓
5. Tool handler:
   a. Validate input (Validator)
   b. Execute command (CommandExecutor)
   c. Parse output
   d. Format response (ResponseFormatter)
   ↓
6. Return formatted response to AI Assistant
```

### Example: `list_devices` Tool Call

```typescript
// 1. AI sends tool call
{
  "name": "list_devices",
  "arguments": { "format": "markdown" }
}

// 2. server.ts routes to deviceTools.list_devices

// 3. Device tool handler executes:
const result = await CommandExecutor.adb(null, ['devices', '-l']);

// 4. Parse and format output
const devices = parseDeviceList(result.stdout);
const formatted = ResponseFormatter.format(devices, 'markdown');

// 5. Return to AI
{
  "content": [{
    "type": "text",
    "text": "| ID | Mode | Model |\n|---|---|---|\n..."
  }]
}
```

---

## Module Structure

### Source Directory Layout

```
src/
├── index.ts              # Entry point
├── server.ts             # MCP server setup and routing
├── config.ts             # Configuration constants
├── types.ts              # TypeScript type definitions
│
├── tools/                # Tool implementations (27 tools)
│   ├── device.ts         # Device management (6 tools)
│   ├── app.ts            # App management (6 tools)
│   ├── file.ts           # File operations (6 tools)
│   └── flash.ts          # Flashing & rooting (8 tools)
│
└── utils/                # Utility modules
    ├── executor.ts       # Command execution
    ├── formatter.ts      # Response formatting
    ├── validator.ts      # Input validation
    ├── error-handler.ts  # Error handling
    └── device-manager.ts # Device state management
```

### Utility Modules

#### `CommandExecutor` (`utils/executor.ts`)

Handles all external command execution with timeout and error handling.

**Methods**:
- `execute(cmd, args)`: Generic command execution
- `adb(deviceId, args)`: ADB-specific execution
- `fastboot(deviceId, args)`: Fastboot-specific execution
- `shell(deviceId, cmd)`: ADB shell command
- `logcat(deviceId, filter)`: Log streaming with limits

**Features**:
- 30-second default timeout
- Automatic error detection (ENOENT for missing binaries)
- Device-specific command routing (`-s` flag)
- Output buffering and trimming

#### `ResponseFormatter` (`utils/formatter.ts`)

Formats data into Markdown or JSON for AI consumption.

**Methods**:
- `format(data, format, detail)`: Main formatting entry point
- `success(message, data)`: Success message formatting
- `error(message, suggestion)`: Error message formatting
- `warning(message)`: Warning message formatting

**Features**:
- Markdown table generation
- Concise vs detailed output modes
- Character limit enforcement (25,000 chars)
- Smart truncation with indicators

#### `Validator` (`utils/validator.ts`)

Validates user inputs and system state before execution.

**Validations**:
- Device existence and mode checking
- Confirmation token verification for destructive operations
- Path sanitization
- Package name format validation
- Slot name validation (a/b partitions)

#### `DeviceManager` (`utils/device-manager.ts`)

Manages device discovery and state tracking.

**Methods**:
- `listDevices()`: Get all connected devices
- `getDeviceInfo(deviceId)`: Fetch comprehensive device data
- `validateDevice(deviceId, mode)`: Ensure device exists in correct mode
- `isDeviceAuthorized(deviceId)`: Check USB debugging authorization

#### `ErrorHandler` (`utils/error-handler.ts`)

Centralizes error handling with actionable messages.

**Features**:
- User-friendly error messages
- Contextual suggestions for common errors
- Structured error types
- Recovery action recommendations

---

## Tool Categories

### 1. Device Management Tools (6 tools)

| Tool | Purpose | Read-Only |
|------|---------|-----------|
| `list_devices` | Enumerate connected devices | ✓ |
| `get_device_info` | Fetch detailed device information | ✓ |
| `check_device_health` | Battery, temperature, and status | ✓ |
| `get_device_logs` | System logs (logcat) with filtering | ✓ |
| `reboot_device` | Reboot to different modes | ✗ |
| `enable_wireless_adb` | Enable ADB over WiFi | ✗ |

### 2. App Management Tools (6 tools)

| Tool | Purpose | Read-Only |
|------|---------|-----------|
| `list_packages` | List installed packages | ✓ |
| `get_app_info` | Detailed package information | ✓ |
| `install_app` | Install APK from local path | ✗ |
| `uninstall_app` | Remove package | ✗ |
| `backup_app` | Extract APK to local filesystem | ✗ |
| `manage_app_state` | Enable/disable/clear data | ✗ |

### 3. File Operations Tools (6 tools)

| Tool | Purpose | Read-Only |
|------|---------|-----------|
| `list_files` | List directory contents | ✓ |
| `pull_file` | Download file from device | ✗ |
| `push_file` | Upload file to device | ✗ |
| `delete_file` | Remove file/directory | ✗ |
| `shell_command` | Execute arbitrary shell command | ✗ |
| `backup_data` | Full device backup | ✗ |

### 4. Flashing & Rooting Tools (8 tools)

| Tool | Purpose | Destructive |
|------|---------|-------------|
| `get_partition_info` | List device partitions | ✗ |
| `flash_partition` | Flash partition image | ✓ |
| `erase_partition` | Wipe partition | ✓ |
| `format_partition` | Format partition | ✓ |
| `boot_image` | Temporarily boot image | ✗ |
| `unlock_bootloader` | Unlock bootloader | ✓ |
| `lock_bootloader` | Lock bootloader | ✓ |
| `flash_all` | Flash entire factory image | ✓ |

---

## Security & Safety

### Destructive Operation Protection

**Confirmation Token System**: Destructive operations require explicit confirmation tokens.

**Format**: `CONFIRM_<OPERATION>_<TIMESTAMP>`

**Example**:
```typescript
// To unlock bootloader:
{
  "confirm_token": "CONFIRM_UNLOCK_BOOTLOADER_1697558400000"
}
```

**Validation Logic**:
```typescript
function validateConfirmationToken(operation: string, token?: string): boolean {
  if (!token) return false;
  
  const expectedPrefix = `CONFIRM_${operation.toUpperCase()}_`;
  if (!token.startsWith(expectedPrefix)) return false;
  
  const timestamp = parseInt(token.split('_').pop() || '0');
  const age = Date.now() - timestamp;
  
  // Token must be recent (within 5 minutes)
  return age < 300000;
}
```

### Protected Operations

All operations in `CONFIG.DESTRUCTIVE_OPERATIONS`:
- `unlock_bootloader`
- `lock_bootloader`
- `flash_partition`
- `erase_partition`
- `format_partition`
- `flash_all`

### Multi-Device Safety

- All operations require explicit `deviceId` parameter
- Device existence validated before execution
- Mode-specific operations (bootloader vs device mode) enforced
- No bulk operations across multiple devices by default

---

## Error Handling

### Error Types

1. **Device Not Found**
   - Lists available devices
   - Suggests running `list_devices()`

2. **Permission Denied**
   - Indicates USB debugging not authorized
   - Prompts user to check device screen

3. **Bootloader Locked**
   - Explains unlocking requirement
   - Warns about data loss

4. **Command Failed**
   - Shows full command and error output
   - Provides exit code
   - Suggests recovery actions

5. **Binary Not Found**
   - Detects missing ADB/Fastboot
   - Provides download link
   - Suggests environment configuration

### Error Response Format

```typescript
{
  content: [{
    type: "text",
    text: "❌ **Error**: Device 'XYZ' not found.\n\n" +
          "💡 **Suggestion**: Run list_devices() to see available devices."
  }],
  isError: true
}
```

---

## Extension Guide

### Adding a New Tool

1. **Choose the appropriate category file** (`tools/device.ts`, `tools/app.ts`, etc.)

2. **Define the tool schema**:

```typescript
export const myNewTool = {
  description: "Clear description of what it does",
  inputSchema: {
    type: "object" as const,
    properties: {
      deviceId: {
        type: "string" as const,
        description: "Target device ID"
      },
      // ... other parameters
    },
    required: ["deviceId"]
  },
  handler: async (args: { deviceId: string }) => {
    // Implementation
  }
};
```

3. **Implement the handler**:

```typescript
handler: async (args: { deviceId: string }) => {
  // 1. Validate input
  Validator.validateDeviceId(args.deviceId);
  
  // 2. Execute command
  const result = await CommandExecutor.adb(
    args.deviceId,
    ['your', 'command', 'args']
  );
  
  // 3. Parse result
  const data = parseYourData(result.stdout);
  
  // 4. Format and return
  return ResponseFormatter.format(data, 'markdown');
}
```

4. **Export the tool** in the category object:

```typescript
export const deviceTools = {
  list_devices,
  get_device_info,
  myNewTool,  // Add here
  // ...
};
```

### Adding a New Utility

1. Create `src/utils/my-utility.ts`
2. Implement as a class with static methods
3. Import and use in tool handlers
4. Export from utility module

---

## Performance Considerations

### Command Timeouts

- Default: 30 seconds
- Configurable via `COMMAND_TIMEOUT` environment variable
- Prevents hanging on unresponsive devices

### Response Size Limits

- Maximum response: 25,000 characters
- Automatic truncation with indicators
- Suggestion to use JSON format for large data

### Log Streaming

- Logcat limited to last 1,000 lines
- Prevents memory issues with long-running devices
- Configurable via `MAX_LOG_LINES`

### Caching Strategy

- No device state caching (real-time data)
- Command results not cached (devices change frequently)
- Device list refreshed on each call

---

## Development Workflow

### Build Process

```bash
# Development build with watch mode
npm run watch

# Production build
npm run build

# Type checking only (no emit)
npm run type-check

# Lint code
npm run lint
```

### Testing

```bash
# Manual testing with Claude Desktop
# 1. Build project
npm run build

# 2. Update claude_desktop_config.json
# 3. Restart Claude Desktop
# 4. Test tools via conversation
```

### Debugging

- Server logs to stderr: `console.error()`
- View logs in Claude Desktop developer tools
- Add debugging logs without affecting MCP protocol

---

## Configuration

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADB_PATH` | `adb` | Path to ADB binary |
| `FASTBOOT_PATH` | `fastboot` | Path to Fastboot binary |
| `COMMAND_TIMEOUT` | `30000` | Command timeout (ms) |
| `MAX_LOG_LINES` | `1000` | Max logcat lines |
| `CHARACTER_LIMIT` | `25000` | Response size limit |

### Claude Desktop Configuration

```json
{
  "mcpServers": {
    "android-debug": {
      "command": "node",
      "args": ["/path/to/dist/index.js"],
      "env": {
        "ADB_PATH": "/path/to/adb",
        "FASTBOOT_PATH": "/path/to/fastboot"
      }
    }
  }
}
```

---

## Dependencies

### Runtime Dependencies

- `@modelcontextprotocol/sdk` (^1.0.4): MCP protocol implementation
- `zod` (^3.24.1): Schema validation

### Development Dependencies

- `typescript` (^5.7.3): TypeScript compiler
- `@types/node` (^22.10.5): Node.js type definitions
- `eslint` (^9.18.0): Code linting
- `@typescript-eslint/*`: TypeScript ESLint plugins

---

## Future Enhancements

### Potential Features

1. **Batch Operations**: Execute commands across multiple devices
2. **Device Monitoring**: Real-time device status updates
3. **Screenshot/Screencap**: Capture device screen
4. **Input Simulation**: Send touch/key events
5. **Package Signing**: Sign APKs before installation
6. **Backup Automation**: Scheduled backup operations
7. **Performance Metrics**: CPU, memory, GPU profiling
8. **Network Traffic Analysis**: Capture and analyze network packets

### Architecture Improvements

1. **Plugin System**: Allow custom tool extensions
2. **Event Streaming**: WebSocket support for real-time updates
3. **State Persistence**: Cache device state with invalidation
4. **Parallel Execution**: Concurrent operations on different devices
5. **Retry Logic**: Automatic retry for transient failures

---

## References

- [Model Context Protocol Specification](https://modelcontextprotocol.io/)
- [Android Debug Bridge (ADB)](https://developer.android.com/tools/adb)
- [Fastboot Protocol](https://android.googlesource.com/platform/system/core/+/master/fastboot/)
- [Android Platform Tools](https://developer.android.com/tools/releases/platform-tools)

---

**Last Updated**: 2025-10-17  
**Version**: 1.0.0  
**Maintainer**: Android Debug MCP Server Team

