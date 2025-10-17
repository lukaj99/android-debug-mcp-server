# Project Structure Guide

This document provides a comprehensive overview of the project organization and file purposes.

## 📂 Directory Layout

```
android-debug-mcp-server/
│
├── 📄 Configuration Files
│   ├── package.json              # NPM package configuration and dependencies
│   ├── package-lock.json         # Locked dependency versions
│   ├── tsconfig.json            # TypeScript compiler configuration
│   ├── .gitignore               # Git ignore patterns
│   └── .env.example             # Environment variable template
│
├── 📚 Documentation
│   ├── README.md                # Quick start and overview
│   ├── ARCHITECTURE.md          # Detailed system architecture
│   ├── CONTRIBUTING.md          # Contribution guidelines
│   ├── CHANGELOG.md             # Version history and changes
│   ├── PROJECT_STRUCTURE.md     # This file
│   ├── LICENSE                  # MIT license
│   └── docs/
│       └── README.md            # Full API reference
│
├── 🧪 Evaluation & Testing
│   └── evaluation/
│       └── evaluation.xml       # Test scenarios and QA pairs
│
├── 📦 Source Code (src/)
│   ├── index.ts                 # Entry point - server initialization
│   ├── server.ts                # MCP server setup and routing
│   ├── config.ts                # Configuration constants and error messages
│   ├── types.ts                 # TypeScript type definitions
│   │
│   ├── tools/                   # Tool implementations (26 tools)
│   │   ├── device.ts            # Device management tools (6)
│   │   ├── app.ts               # App management tools (6)
│   │   ├── file.ts              # File operations tools (6)
│   │   └── flash.ts             # Flashing & rooting tools (8)
│   │
│   └── utils/                   # Utility modules
│       ├── executor.ts          # Command execution (ADB/Fastboot)
│       ├── formatter.ts         # Response formatting (Markdown/JSON)
│       ├── validator.ts         # Input validation and safety checks
│       ├── error-handler.ts     # Error handling and messaging
│       └── device-manager.ts    # Device discovery and management
│
├── 🏗️ Build Output (dist/)
│   ├── index.js                 # Compiled entry point
│   ├── server.js                # Compiled server
│   ├── config.js                # Compiled config
│   ├── types.js                 # Compiled types
│   ├── tools/                   # Compiled tools
│   ├── utils/                   # Compiled utilities
│   ├── *.d.ts                   # TypeScript declaration files
│   ├── *.d.ts.map              # Declaration source maps
│   └── *.js.map                # JavaScript source maps
│
└── 📦 Dependencies (node_modules/)
    └── [External packages]
```

---

## 📄 Core Files

### Root Configuration Files

#### `package.json`
**Purpose**: NPM package definition and project metadata

**Key Sections**:
- `scripts`: Build, lint, type-check, and development commands
- `dependencies`: Runtime dependencies (@modelcontextprotocol/sdk, zod)
- `devDependencies`: Development tools (TypeScript, ESLint)
- `engines`: Node.js version requirement (18+)
- `files`: Files to include in NPM package

#### `tsconfig.json`
**Purpose**: TypeScript compiler configuration

**Key Settings**:
- Target: ES2022
- Module system: ES2022 modules
- Strict type checking enabled
- Declaration files and source maps generated
- Output directory: `./dist`

#### `.gitignore`
**Purpose**: Specifies files to exclude from Git

**Excluded**:
- `node_modules/` - Dependencies
- `dist/` - Build artifacts
- `.env*` - Environment files
- Log files, OS files, IDE files
- Temporary and backup files

#### `.env.example`
**Purpose**: Template for environment configuration

**Variables**:
- `ADB_PATH`: Path to ADB binary
- `FASTBOOT_PATH`: Path to Fastboot binary
- `COMMAND_TIMEOUT`: Command execution timeout (ms)
- `MAX_LOG_LINES`: Maximum logcat lines to return
- `CHARACTER_LIMIT`: Response size limit

---

## 📚 Documentation Files

### `README.md`
- **Audience**: End users and developers
- **Content**: Quick start, installation, features overview
- **Entry point**: First file users should read

### `ARCHITECTURE.md`
- **Audience**: Developers and contributors
- **Content**: System architecture, data flow, design patterns
- **Use cases**: Understanding codebase structure, making architectural decisions

### `CONTRIBUTING.md`
- **Audience**: Contributors
- **Content**: Development setup, coding standards, PR guidelines
- **Use cases**: Contributing code, submitting pull requests

### `CHANGELOG.md`
- **Audience**: Users and maintainers
- **Content**: Version history, feature additions, bug fixes
- **Use cases**: Tracking changes, understanding version differences

### `PROJECT_STRUCTURE.md` (this file)
- **Audience**: New developers
- **Content**: File and directory organization
- **Use cases**: Navigating the codebase, understanding file purposes

### `LICENSE`
- **Type**: MIT License
- **Purpose**: Legal terms for usage and distribution

### `docs/README.md`
- **Audience**: API users (AI assistants, developers)
- **Content**: Detailed API reference for all 26 tools
- **Use cases**: Looking up tool syntax, parameters, examples

---

## 📦 Source Code Organization

### Entry Point Layer

#### `src/index.ts` (12 lines)
- **Purpose**: Application entry point
- **Responsibilities**:
  - Import and start server
  - Handle top-level errors
  - Exit with appropriate code on failure

**Size**: Minimal (intentionally kept simple)

---

### Server Layer

#### `src/server.ts` (~103 lines)
- **Purpose**: MCP server implementation
- **Responsibilities**:
  - Create MCP server instance
  - Register all tools from 4 categories
  - Handle ListTools requests
  - Route CallTool requests to handlers
  - Format responses per MCP spec
  - Error handling and response formatting

**Key Functions**:
- `createServer()`: Initialize and configure server
- `startServer()`: Connect transport and start listening

---

### Configuration Layer

#### `src/config.ts` (~50 lines)
- **Purpose**: Centralized configuration
- **Exports**:
  - `CONFIG`: Runtime configuration constants
  - `ERROR_MESSAGES`: Standardized error message templates

**Benefits**:
- Single source of truth for settings
- Easy to modify timeouts, limits, paths
- Consistent error messages across codebase

---

### Type System

#### `src/types.ts` (~92 lines)
- **Purpose**: TypeScript type definitions
- **Key Types**:
  - `Device`, `DeviceInfo`: Device representations
  - `Package`, `FileInfo`: Android data structures
  - `CommandResult`: Command execution results
  - `PartitionInfo`, `FlashOptions`: Flashing operations
  - Enums: `DeviceMode`, `RebootMode`, `OutputFormat`, etc.

**Benefits**:
- Type safety throughout codebase
- Auto-completion in IDEs
- Prevents type-related bugs

---

### Tools Layer (`src/tools/`)

Each tool file exports:
1. **Zod schemas**: Input validation schemas
2. **Tool objects**: Description, inputSchema, handler function
3. **Category export**: Object containing all tools in category

#### `device.ts` (~440 lines)
**Tools (6)**:
- `list_devices`: Enumerate connected devices
- `get_device_info`: Detailed device information
- `check_device_health`: Battery, temperature, status
- `get_device_logs`: Logcat with filtering
- `reboot_device`: Reboot to different modes
- `enable_wireless_adb`: WiFi ADB setup

#### `app.ts` (~380 lines)
**Tools (6)**:
- `list_packages`: List installed apps
- `get_app_info`: Package details
- `install_app`: Install APK files
- `uninstall_app`: Remove packages
- `backup_app`: Extract APK
- `manage_app_state`: Enable/disable/clear

#### `file.ts` (~320 lines)
**Tools (6)**:
- `list_files`: Directory contents
- `pull_file`: Download from device
- `push_file`: Upload to device
- `delete_file`: Remove files
- `shell_command`: Execute shell commands
- `backup_data`: Full device backup

#### `flash.ts` (~450 lines)
**Tools (8)**:
- `get_partition_info`: List partitions
- `flash_partition`: Flash partition image
- `erase_partition`: Wipe partition
- `format_partition`: Format partition
- `boot_image`: Boot temporary image
- `unlock_bootloader`: Unlock bootloader
- `lock_bootloader`: Lock bootloader
- `flash_all`: Flash factory image

**Total**: 26 tools across ~1,590 lines

---

### Utilities Layer (`src/utils/`)

#### `executor.ts` (~110 lines)
**Purpose**: Command execution wrapper
**Key Methods**:
- `execute()`: Generic command execution with timeout
- `adb()`: ADB-specific execution
- `fastboot()`: Fastboot-specific execution
- `shell()`: ADB shell commands
- `logcat()`: Log streaming

**Features**:
- Timeout handling (default 30s)
- Automatic binary detection (ENOENT errors)
- Device targeting (`-s` flag)
- Output buffering and cleanup

#### `formatter.ts` (~193 lines)
**Purpose**: Response formatting for AI consumption
**Key Methods**:
- `format()`: Main entry point (Markdown/JSON)
- `formatTable()`: Generate Markdown tables
- `success()`, `error()`, `warning()`: Message templates

**Features**:
- Automatic table generation from objects
- Concise vs detailed modes
- Character limit enforcement (25k)
- Smart truncation

#### `validator.ts` (~167 lines)
**Purpose**: Input validation and safety
**Key Methods**:
- `validateConfirmationToken()`: Destructive operation checks
- `validateDevicePath()`: Path security
- `validatePartitionName()`: Partition name validation
- `validateShellCommand()`: Command injection prevention
- `validatePackageName()`: Package format checks

**Security Features**:
- Confirmation token system
- Command injection prevention
- Path traversal protection
- Dangerous command blocking

#### `device-manager.ts` (~154 lines)
**Purpose**: Device discovery and state management
**Key Methods**:
- `listDevices()`: Enumerate all devices (ADB + Fastboot)
- `validateDevice()`: Check device existence and authorization
- `isInMode()`: Check device mode

**Features**:
- Device caching (5s TTL)
- ADB + Fastboot discovery
- Authorization checking
- Offline/unauthorized detection

#### `error-handler.ts` (~100 lines, estimated)
**Purpose**: Centralized error handling
**Key Methods**:
- `handle()`: Process and format errors
- Error type detection
- Contextual error messages

---

## 🏗️ Build Output (`dist/`)

Generated by TypeScript compiler (`tsc`):

### Generated Files
- **`.js`**: Compiled JavaScript (ES2022 modules)
- **`.d.ts`**: TypeScript declarations (for library consumers)
- **`.js.map`**: Source maps (for debugging)
- **`.d.ts.map`**: Declaration source maps

### Structure
Mirrors `src/` directory structure:
```
dist/
├── index.js, index.d.ts, index.js.map, index.d.ts.map
├── server.js, server.d.ts, ...
├── config.js, config.d.ts, ...
├── types.js, types.d.ts, ...
├── tools/
│   ├── device.js, device.d.ts, ...
│   ├── app.js, app.d.ts, ...
│   ├── file.js, file.d.ts, ...
│   └── flash.js, flash.d.ts, ...
└── utils/
    ├── executor.js, executor.d.ts, ...
    ├── formatter.js, formatter.d.ts, ...
    └── ...
```

### Build Commands
```bash
npm run build       # Full build
npm run watch       # Watch mode (rebuild on change)
npm run clean       # Remove dist/ directory
npm run type-check  # Type check without emit
```

---

## 🧪 Evaluation

### `evaluation/evaluation.xml`
**Purpose**: Test scenarios for MCP server functionality

**Content**:
- 10 multi-step test scenarios
- Expected outcomes for each scenario
- Tests requiring 2-5+ tool calls
- Covers all tool categories

**Use cases**:
- Manual testing reference
- Automated testing foundation
- Documentation of expected behavior

---

## 📊 Code Statistics

### Source Code Breakdown

| Category | Files | Lines (approx) |
|----------|-------|----------------|
| Entry Point | 1 | 12 |
| Server Layer | 1 | 103 |
| Configuration | 1 | 50 |
| Types | 1 | 92 |
| **Tools** | **4** | **~1,590** |
| **Utilities** | **5** | **~724** |
| **Total Source** | **13** | **~2,571** |

### Documentation

| File | Lines (approx) | Purpose |
|------|----------------|---------|
| README.md | ~90 | Quick start |
| ARCHITECTURE.md | ~650 | System design |
| CONTRIBUTING.md | ~380 | Dev guide |
| CHANGELOG.md | ~70 | Version history |
| PROJECT_STRUCTURE.md | ~550 | This file |
| docs/README.md | Variable | API reference |
| **Total Docs** | **~1,740+** | |

### Code-to-Documentation Ratio
- **Source code**: ~2,571 lines
- **Documentation**: ~1,740+ lines
- **Ratio**: ~1.5:1 (code:docs)

This ratio indicates **well-documented** project with comprehensive guides.

---

## 🎯 Navigation Tips

### Finding Specific Functionality

| Task | Location |
|------|----------|
| Add a new tool | `src/tools/<category>.ts` |
| Modify error messages | `src/config.ts` → `ERROR_MESSAGES` |
| Change command timeout | `src/config.ts` → `CONFIG.COMMAND_TIMEOUT` |
| Update type definitions | `src/types.ts` |
| Modify response format | `src/utils/formatter.ts` |
| Add validation | `src/utils/validator.ts` |
| Change device discovery | `src/utils/device-manager.ts` |
| Update tool registration | `src/server.ts` → `createServer()` |

### Understanding Flow

1. **Entry**: `index.ts` → `server.ts`
2. **Request**: MCP protocol → `CallToolRequestSchema` handler
3. **Routing**: Tool name lookup → Category tool handler
4. **Execution**: Handler → Validator → Executor → Formatter
5. **Response**: Formatted result → MCP protocol → AI

### Testing Changes

1. Make changes in `src/`
2. Build: `npm run build`
3. Update Claude Desktop config
4. Restart Claude Desktop
5. Test via conversation

---

## 🔧 Development Workflow

### Quick Reference

```bash
# Setup
npm install                  # Install dependencies
cp .env.example .env        # Configure environment

# Development
npm run watch               # Auto-rebuild on save
npm run dev                 # Build + run once

# Quality Checks
npm run lint               # Check code style
npm run type-check         # Verify types
npm run build              # Full production build

# Cleanup
npm run clean              # Remove build artifacts
```

### File Modification Frequency

**High frequency** (often modified):
- `src/tools/*.ts` - Adding/modifying tools
- `docs/README.md` - API documentation updates

**Medium frequency**:
- `src/utils/*.ts` - Utility improvements
- `README.md` - Feature updates
- `CHANGELOG.md` - Version tracking

**Low frequency** (rarely modified):
- `src/server.ts` - MCP setup
- `src/config.ts` - Configuration
- `tsconfig.json` - Compiler settings
- `package.json` - Dependencies

**Never modify**:
- `dist/` - Generated files
- `node_modules/` - External dependencies

---

## 📚 Related Documentation

- **Architecture deep dive**: [ARCHITECTURE.md](./ARCHITECTURE.md)
- **Contributing guide**: [CONTRIBUTING.md](./CONTRIBUTING.md)
- **Version history**: [CHANGELOG.md](./CHANGELOG.md)
- **API reference**: [docs/README.md](./docs/README.md)
- **Quick start**: [README.md](./README.md)

---

**Last Updated**: 2025-10-17  
**Version**: 1.0.0


