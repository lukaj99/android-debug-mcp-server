# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2025-10-17

### Added
- Initial release of Android Debug MCP Server
- 26 tools across 4 categories (device, app, file, flash)
- Device management tools (6 tools)
  - `list_devices` - List all connected devices
  - `get_device_info` - Get detailed device information
  - `check_device_health` - Check battery and system health
  - `get_device_logs` - Retrieve system logs with filtering
  - `reboot_device` - Reboot to different modes
  - `enable_wireless_adb` - Enable ADB over WiFi
- App management tools (6 tools)
  - `list_packages` - List installed packages
  - `get_app_info` - Get app details
  - `install_app` - Install APK files
  - `uninstall_app` - Remove packages
  - `backup_app` - Backup APK files
  - `manage_app_state` - Enable/disable/clear apps
- File operations tools (6 tools)
  - `list_files` - List directory contents
  - `pull_file` - Download files from device
  - `push_file` - Upload files to device
  - `delete_file` - Remove files/directories
  - `shell_command` - Execute shell commands
  - `backup_data` - Full device backup
- Flashing & rooting tools (8 tools)
  - `get_partition_info` - List device partitions
  - `flash_partition` - Flash partition images
  - `erase_partition` - Wipe partitions
  - `format_partition` - Format partitions
  - `boot_image` - Boot temporary images
  - `unlock_bootloader` - Unlock bootloader
  - `lock_bootloader` - Lock bootloader
  - `flash_all` - Flash factory images
- Comprehensive error handling with actionable messages
- Response formatting (Markdown and JSON)
- Confirmation token system for destructive operations
- Multi-device support
- Configurable timeouts and limits
- TypeScript with strict type checking
- Complete documentation (Architecture, Contributing, API)

### Security
- Destructive operations require confirmation tokens
- Device-specific operations prevent bulk accidents
- Bootloader operations warn about data loss

## [Unreleased]

### Planned Features
- Screenshot capture tool
- Screen recording tool
- Input simulation (touch, swipe, key events)
- Network traffic capture and analysis
- Performance profiling tools
- Batch operations across multiple devices
- Real-time device monitoring
- Package signing capabilities

---

## Version History

### Version Numbering
- **Major** (1.x.x): Breaking changes to API or MCP protocol
- **Minor** (x.1.x): New features, backward compatible
- **Patch** (x.x.1): Bug fixes, minor improvements

### Release Notes Format
Each version includes:
- **Added**: New features
- **Changed**: Changes to existing functionality
- **Deprecated**: Soon-to-be removed features
- **Removed**: Removed features
- **Fixed**: Bug fixes
- **Security**: Security improvements

---

For detailed changes, see commit history on GitHub.
