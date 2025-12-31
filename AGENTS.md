# AI Agent Context

> I am an AI assistant working on android-debug-mcp-server.
> MCP server providing 35 tools for Android debugging via ADB/Fastboot.
> Single source of truth for Claude Code and Gemini CLI.

## Project

TypeScript MCP server exposing Android device management, app ops, file transfers, flashing, and screen interaction. Uses stdio transport for Claude Desktop integration.

```
src/
├── index.ts          # Entry point
├── server.ts         # MCP server, tool registration
├── config.ts         # Config constants, error messages
├── types.ts          # TypeScript definitions
├── tools/
│   ├── device.ts     # 7 tools: list, info, reboot, logs, health, wireless, setup
│   ├── app.ts        # 6 tools: list, info, install, uninstall, backup, state
│   ├── file.ts       # 6 tools: list, push, pull, delete, shell, backup
│   ├── flash.ts      # 10 tools: flash, erase, format, boot, unlock, slots, dump
│   └── interaction.ts # 6 tools: screenshot, screen info, tap, swipe, text, record
└── utils/
    ├── executor.ts           # Command execution, auto-install
    ├── validator.ts          # Input validation, safety checks
    ├── formatter.ts          # Response formatting (Markdown/JSON)
    ├── error-handler.ts      # Centralized error handling
    ├── device-manager.ts     # Device discovery, state
    └── platform-tools-manager.ts  # Auto-download ADB/Fastboot
```

## Critical Rules

```
NEVER: Log to stdout (breaks MCP stdio protocol)
NEVER: Skip confirmation tokens for destructive ops
NEVER: Flash without validating device is in fastboot mode
NEVER: Guess device_id - always validate first
NEVER: Bypass SafetyValidator for any destructive operation

ALWAYS: Use console.error() for debugging output
ALWAYS: Validate device_id with DeviceManager before operations
ALWAYS: Use CommandExecutor.adb() / .fastboot() for commands
ALWAYS: Wrap handlers in ErrorHandler.wrap()
ALWAYS: Return via ResponseFormatter.format()
```

## Circuit Breakers

```
IF: About to run fastboot command → VERIFY device is in fastboot mode
IF: Destructive operation → REQUIRE confirm_token (CONFIRM_<OP>_<timestamp>)
IF: Command returns ENOENT → Trigger platform tools auto-install
IF: Device not found → Return available devices list
IF: Bootloader locked → Block flash operations, suggest unlock
```

## Commands

```bash
# Build & Development
npm run build          # TypeScript → JavaScript (dist/)
npm run watch          # Build with file watching
npm run type-check     # Type check only (no emit)
npm run lint           # ESLint src/**/*.ts
npm run dev            # Build + start server
npm start              # Run server (requires build)
npm run clean          # Remove dist/

# Testing with Claude Desktop
# 1. Build: npm run build
# 2. Update: ~/Library/Application Support/Claude/claude_desktop_config.json
# 3. Restart Claude Desktop
```

## Architecture

```
AI Assistant → MCP Request (stdio)
                  ↓
            server.ts (routing)
                  ↓
            tools/*.ts (handlers)
                  ↓
            utils/ (validation, execution)
                  ↓
            ADB/Fastboot (external binaries)
```

**Key Patterns:**
- Tool handler: `{ description, inputSchema, handler }`
- All ADB/Fastboot via `CommandExecutor.adb()` / `.fastboot()`
- Destructive ops require `CONFIRM_<OP>_<TIMESTAMP>` tokens (5min expiry)
- Auto-install platform tools on first ENOENT error

## Tool Categories

| Category | Tools | Risk Level |
|----------|-------|------------|
| device | 7 | Low (mostly read-only) |
| app | 6 | Medium (can modify apps) |
| file | 6 | Medium (filesystem access) |
| flash | 10 | **High** (requires tokens) |
| interaction | 6 | Medium (screen control) |

**Destructive Operations (require tokens):**
- `unlock_bootloader` / `lock_bootloader` - **Wipes ALL data**
- `flash_partition` / `erase_partition` / `format_partition`
- `flash_all` / `dump_partition`

## Data

> Router: `src/types.ts` for TypeScript interfaces
> Router: `src/config.ts` for constants and error messages
> Router: `docs/README.md` for API reference

| Data | Source of Truth |
|------|-----------------|
| TypeScript types | `src/types.ts` |
| Config/errors | `src/config.ts` |
| Tool schemas | `src/tools/*.ts` (Zod schemas) |
| API docs | `docs/README.md` |

## Environment

| Variable | Default | Description |
|----------|---------|-------------|
| `ADB_PATH` | `adb` | ADB binary (auto-detected) |
| `FASTBOOT_PATH` | `fastboot` | Fastboot binary (auto-detected) |
| `COMMAND_TIMEOUT` | `30000` | Command timeout (ms) |
| `MAX_LOG_LINES` | `1000` | Logcat line limit |
| `CHARACTER_LIMIT` | `25000` | Response size limit |

## Adding Tools

1. Choose category: `src/tools/{device,app,file,flash,interaction}.ts`
2. Define schema with Zod
3. Create tool object: `{ description, inputSchema, handler }`
4. Handler pattern:
   ```typescript
   handler: async (args) => ErrorHandler.wrap(async () => {
     await DeviceManager.validateDevice(args.device_id);
     // Validate inputs with SafetyValidator
     // Execute with CommandExecutor.adb() or .fastboot()
     return ResponseFormatter.format(result, args.format, args.detail);
   })
   ```
5. Export in category object

## Guardrails

```
IF: Modifying flash.ts → READ Critical Rules first
IF: Adding destructive op → ADD to CONFIG.DESTRUCTIVE_OPERATIONS
IF: Unsure about ADB command → CHECK device state first
IF: 3 consecutive test failures → STOP and review approach
IF: Stdout logging detected → FIX immediately (breaks MCP)
```
