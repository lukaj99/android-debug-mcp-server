# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

This is an **MCP (Model Context Protocol) server** that provides AI assistants with comprehensive Android device debugging capabilities through ADB and Fastboot. It exposes 35 tools across 5 categories for device management, app operations, file transfers, system flashing, and screen interaction.

**Key Tech Stack:**
- TypeScript (ES2022 modules)
- Node.js 18+
- MCP SDK v1.0
- Transport: stdio

## Build & Development Commands

```bash
# Build (TypeScript → JavaScript)
npm run build

# Development with auto-rebuild
npm run watch

# Type checking only (no emit)
npm run type-check

# Linting
npm run lint

# Start server (after build)
npm start

# Dev: build + start
npm run dev

# Clean build artifacts
npm run clean
```

## Code Architecture

### High-Level Structure

The codebase follows a **layered architecture**:

```
Entry Point (index.ts)
    ↓
MCP Server Layer (server.ts) - Tool registration & routing
    ↓
Tool Categories (tools/*.ts) - 5 modules with 35 tools
    ↓
Utility Layer (utils/*.ts) - Shared functionality
    ↓
Platform Tools (ADB/Fastboot) - External binaries
```

### Source Organization

- **`src/index.ts`**: Entry point, starts server
- **`src/server.ts`**: MCP server setup, tool registration, request routing
- **`src/config.ts`**: Configuration constants and error messages
- **`src/types.ts`**: TypeScript type definitions

**Tool Categories** (`src/tools/`):
- **`device.ts`**: 7 device management tools (list, info, reboot, logs, health, wireless ADB, platform tools setup)
- **`app.ts`**: 6 app management tools (list, info, install, uninstall, backup, state management)
- **`file.ts`**: 6 file operation tools (list, push, pull, delete, shell, backup)
- **`flash.ts`**: 10 flashing/partition management tools (flash, erase, format, boot, bootloader, slots, dump)
- **`interaction.ts`**: 6 screen & interaction tools (screenshot, screen info, tap, swipe, text input, recording)

**Utilities** (`src/utils/`):
- **`executor.ts`**: Command execution with timeout, auto-install platform tools
- **`formatter.ts`**: Response formatting (Markdown/JSON, byte formatting)
- **`validator.ts`**: Input validation and safety checks (includes coordinate & keycode validation)
- **`error-handler.ts`**: Centralized error handling
- **`device-manager.ts`**: Device discovery and state management
- **`platform-tools-manager.ts`**: Auto-download and install ADB/Fastboot

### Key Design Patterns

1. **Tool Handler Pattern**: Each tool has `description`, `inputSchema`, and `handler`
2. **Command Execution**: All external commands go through `CommandExecutor` class
3. **Validation First**: All inputs validated before execution
4. **Format Agnostic**: Tools format output as Markdown or JSON
5. **Safety Tokens**: Destructive operations require confirmation tokens

### Critical Implementation Details

**Auto-Installation of Platform Tools:**
- First use of ADB/Fastboot triggers auto-download to `~/.android-debug-mcp/platform-tools/`
- `CommandExecutor.execute()` detects ENOENT errors and calls `PlatformToolsManager`
- Implemented in `executor.ts:62-121`

**Confirmation Token System:**
- Destructive operations (flash, unlock, erase) require tokens
- Format: `CONFIRM_<OPERATION>_<TIMESTAMP>`
- Tokens expire after 5 minutes
- Prevents accidental device damage

**Response Size Management:**
- Max 25,000 characters per response
- Logcat limited to 1,000 lines
- Automatic truncation with indicators
- Configured in `config.ts`

**Multi-Device Support:**
- All operations require explicit `deviceId`
- Commands use `-s <deviceId>` flag
- Device validation before execution

## Common Development Tasks

### Adding a New Tool

1. Choose category file: `tools/device.ts`, `tools/app.ts`, `tools/file.ts`, `tools/flash.ts`, or `tools/interaction.ts`
2. Define tool with `description`, `inputSchema`, and `handler`
3. Implement handler using utilities:
   - Validate with `Validator.*`
   - Execute with `CommandExecutor.adb()` or `.fastboot()`
   - Format with `ResponseFormatter.format()`
4. Export tool in category object

### Testing Changes

1. Build: `npm run build`
2. Update `~/Library/Application Support/Claude/claude_desktop_config.json`
3. Restart Claude Desktop
4. Test tools via conversation

### Debugging

- Server logs to **stderr** (use `console.error()`)
- View logs in Claude Desktop developer tools
- MCP protocol uses stdout - never log to stdout

## Code Style

Per `.editorconfig`:
- 2-space indentation for TypeScript/JavaScript
- LF line endings
- UTF-8 encoding
- Trim trailing whitespace
- Insert final newline

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `ADB_PATH` | `adb` | Path to ADB binary (auto-detected if installed) |
| `FASTBOOT_PATH` | `fastboot` | Path to Fastboot binary (auto-detected if installed) |
| `COMMAND_TIMEOUT` | `30000` | Command timeout in milliseconds |
| `MAX_LOG_LINES` | `1000` | Maximum logcat lines |
| `CHARACTER_LIMIT` | `25000` | Response size limit |

## Important Safety Considerations

**Destructive Operations:**
- Unlocking bootloader wipes all data
- Flashing wrong partition can brick device
- Always validate device ID and partition names
- Confirmation tokens required for safety

**Tool Categories:**
- Device & App tools: Mostly read-only, low risk
- File tools: Can modify device filesystem
- Flash tools: High risk, require confirmation tokens
- Interaction tools: Screen capture and input simulation (medium risk)

## Architecture Notes

**MCP Protocol Flow:**
1. AI Assistant sends `CallToolRequest` via stdio
2. `server.ts` routes to appropriate tool handler
3. Handler validates, executes, formats response
4. Server returns MCP-compliant response

**Why stdio?**
- Standard MCP transport mechanism
- Works with Claude Desktop out-of-the-box
- Simple, reliable process communication

**Why TypeScript ES modules?**
- Modern JavaScript with type safety
- Native Node.js ES module support (Node 18+)
- Better tooling and IDE support

## File References

- Full architecture documentation: `ARCHITECTURE.md`
- API reference: `docs/README.md`
- Contributing guide: `CONTRIBUTING.md`
- Security policy: `SECURITY.md`
