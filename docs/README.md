# Android Debug MCP Server

A Model Context Protocol (MCP) server for Android USB debugging, providing comprehensive access to ADB, Fastboot, and Android Platform Tools.

## Features

### 27 Tools Across 4 Categories

**Device Management (7 tools):**
- `list_devices` - List all connected devices
- `get_device_info` - Get detailed device information
- `reboot_device` - Reboot to different modes
- `connect_wireless` - Enable wireless ADB
- `get_device_logs` - Get logcat output
- `check_device_health` - Battery, storage, memory diagnostics
- `setup_platform_tools` - Download and install Android Platform Tools

**App Management (6 tools):**
- `list_packages` - List installed packages
- `install_app` - Install APK
- `uninstall_app` - Uninstall package
- `backup_app` - Backup APK and data
- `get_app_info` - Package details
- `manage_app_state` - Enable/disable/clear-data/force-stop

**File Operations (6 tools):**
- `push_files` - Upload files to device
- `pull_files` - Download files from device
- `list_files` - List directory contents
- `backup_partition` - Dump partition to file
- `execute_shell` - Run shell commands
- `sync_data` - Sync filesystem buffers

**Flashing & Rooting (8 tools):**
- `flash_partition` - Flash partition image
- `boot_image` - Boot image temporarily
- `unlock_bootloader` - Unlock bootloader (WIPES DATA!)
- `lock_bootloader` - Lock bootloader (WIPES DATA!)
- `erase_partition` - Erase partition
- `format_partition` - Format partition
- `set_active_slot` - Switch A/B slots
- `flash_all` - Flash factory image

## Installation

### Prerequisites

1. **Node.js 18+**
2. **Android Platform Tools** (ADB & Fastboot) - **Auto-installed on first use!**
   - Tools are automatically downloaded to `~/.android-debug-mcp/platform-tools/`
   - Manual setup: Use the `setup_platform_tools()` tool
   - Or download manually: https://developer.android.com/tools/releases/platform-tools
   - You can set `ADB_PATH` and `FASTBOOT_PATH` environment variables to override

### Setup

```bash
# Clone or download the server
cd android-debug-mcp-server

# Install dependencies
npm install

# Build the server
npm run build

# Test the server
npm run start
```

## Usage

### Configure MCP Client

Add to your MCP client configuration:

**Claude Desktop (config.json):**
```json
{
  "mcpServers": {
    "android-debug": {
      "command": "node",
      "args": ["/path/to/android-debug-mcp-server/dist/index.js"],
      "env": {
        "ADB_PATH": "/path/to/platform-tools/adb",
        "FASTBOOT_PATH": "/path/to/platform-tools/fastboot"
      }
    }
  }
}
```

### Enable USB Debugging

On your Android device:
1. Go to **Settings** > **About phone**
2. Tap **Build number** 7 times (enables Developer Options)
3. Go to **Settings** > **Developer options**
4. Enable **USB debugging**
5. Connect via USB and authorize the computer

### Basic Workflows

**Setup platform tools (first time):**
```
setup_platform_tools()
```

**List connected devices:**
```
list_devices()
```

**Get device info:**
```
get_device_info(device_id="ABC123")
```

**Install APK:**
```
install_app(device_id="ABC123", apk_path="/path/to/app.apk")
```

**Backup photos:**
```
pull_files(device_id="ABC123", remote_path="/sdcard/DCIM/", local_path="/backups/photos/")
```

**Check device health:**
```
check_device_health(device_id="ABC123")
```

## Safety Features

### Confirmation Tokens

Destructive operations require confirmation tokens to prevent accidental data loss:

**Operations requiring tokens:**
- `unlock_bootloader` - Wipes all data
- `lock_bootloader` - Wipes all data
- `flash_partition` - Overwrites partition
- `erase_partition` - Deletes partition
- `format_partition` - Formats partition
- `flash_all` - Wipes device completely

**Generate token:**
```
CONFIRM_<OPERATION>_<timestamp>
```

**Example:**
```
unlock_bootloader(
  device_id="ABC123",
  confirm_token="CONFIRM_UNLOCK_BOOTLOADER_1699999999000"
)
```

Tokens expire after 60 seconds.

### Multi-Device Support

All tools accept `device_id` parameter. Use `list_devices()` to see available devices, then specify the exact device ID for operations.

## Configuration

Create `.env` file (see `.env.example`):

```bash
# ADB/Fastboot paths (optional if in PATH)
ADB_PATH=/path/to/platform-tools/adb
FASTBOOT_PATH=/path/to/platform-tools/fastboot

# Timeout for commands (milliseconds)
COMMAND_TIMEOUT=30000

# Maximum log lines
MAX_LOG_LINES=1000

# Character limit for responses
CHARACTER_LIMIT=25000
```

## Advanced Usage

### Wireless ADB

```
# Enable wireless ADB
connect_wireless(device_id="ABC123")

# Device IP will be returned
# Use IP:port as device_id for wireless operations
list_devices()  # Will show wireless device

# Disconnect USB cable (keep WiFi connected)
# Continue using device_id="192.168.1.100:5555"
```

### Bootloader Operations

```
# Reboot to fastboot
reboot_device(device_id="ABC123", mode="bootloader")

# Wait for reboot...
list_devices()  # Device will show mode="bootloader"

# Unlock bootloader (WIPES DATA!)
unlock_bootloader(
  device_id="ABC123",
  confirm_token="CONFIRM_UNLOCK_BOOTLOADER_1699999999000"
)

# Flash custom boot image
flash_partition(
  device_id="ABC123",
  partition="boot",
  image_path="/images/custom-boot.img",
  confirm_token="CONFIRM_FLASH_PARTITION_1699999999000"
)

# Reboot
reboot_device(device_id="ABC123", mode="system")
```

### App Management

```
# List user apps
list_packages(device_id="ABC123", filter="user")

# Get app details
get_app_info(device_id="ABC123", package_name="com.example.app")

# Grant permission
manage_app_state(
  device_id="ABC123",
  package_name="com.example.app",
  action="grant-permission",
  permission="android.permission.CAMERA"
)

# Backup APK
backup_app(
  device_id="ABC123",
  package_name="com.example.app",
  output_path="/backups/"
)
```

## Troubleshooting

### Device not found
- Enable USB debugging
- Authorize computer on device screen
- Check USB cable and port
- Try `adb devices` directly

### Unauthorized device
- Check device screen for authorization dialog
- Revoke authorizations: Settings > Developer Options > Revoke USB debugging authorizations
- Reconnect and authorize again

### Bootloader locked error
- Enable OEM unlocking: Settings > Developer Options > OEM unlocking
- Some manufacturers don't allow bootloader unlock
- Check manufacturer website for unlock instructions

### ADB not found
- **Auto-install (recommended)**: Use `setup_platform_tools()` tool to automatically download and install
- Tools will be installed to `~/.android-debug-mcp/platform-tools/`
- Manual install: Download from https://developer.android.com/tools/releases/platform-tools
- Add to PATH or set `ADB_PATH` environment variable
- On first command, tools will be automatically downloaded if not found

## Security Considerations

⚠️ **Expert Mode Active** - This server includes destructive operations:

1. **Bootloader unlock/lock** - Wipes all data
2. **Flash operations** - Can brick device if used incorrectly
3. **Partition erase/format** - Permanent data loss
4. **Shell command execution** - Unrestricted system access

**Recommendations:**
- Only use on devices you own
- Backup data before destructive operations
- Double-check device_id and partition names
- Test on non-production devices first
- Keep confirmation tokens secure
- Review tool descriptions carefully

## Output Formats

All tools support multiple output formats:

**Markdown (default):**
- Human-readable tables and lists
- Formatted for LLM context windows
- Automatic truncation at 25,000 characters

**JSON:**
- Structured data for programmatic access
- Complete field information
- Use `format="json"` parameter

**Detail levels:**
- `concise` (default) - Key fields only
- `detailed` - All available fields

## Development

### Build
```bash
npm run build
```

### Type Check
```bash
npm run type-check
```

### Lint
```bash
npm run lint
```

### Watch Mode
```bash
npm run watch
```

## License

MIT

## Disclaimer

⚠️ **USE AT YOUR OWN RISK**

This tool provides low-level access to Android devices. Improper use can:
- Brick your device
- Void your warranty
- Erase all data
- Cause boot loops
- Trigger security features (Knox, SafetyNet)

The authors are not responsible for any damage caused by using this software.

## Inspiration

Inspired by [Pixel Flasher](https://github.com/badabing2005/PixelFlasher) - a GUI tool for Android device management.

## Support

For issues and feature requests, please file an issue on the GitHub repository.
