# Research Findings

## Relevant Files
| File | Purpose | Needs Changes |
|------|---------|---------------|
| `src/utils/device-manager.ts` | Device discovery and management | Yes (Parallel discovery) |
| `src/tools/device.ts` | Device info and basic tools | Yes (Batch info, new tools: `get_recent_crashes`, `forward_port`) |
| `src/config.ts` | Configuration constants | Yes (Cache TTL) |
| `src/tools/flash.ts` | Flashing and partition tools | Yes (Batch partition sizes, streaming hash) |
| `src/tools/interaction.ts` | Screen interaction tools | Yes (Async base64, new tool: `dump_ui_hierarchy`) |
| `src/utils/executor.ts` | Command execution | No (Already supports what we need) |

## Dependencies
- **External Libraries**: 
    - `zod` (Input validation)
    - `crypto` (Hashing)
    - `fs` (File system)
- **Internal Modules**:
    - `CommandExecutor` (ADB/Fastboot calls)
    - `DeviceManager` (Device validation)
    - `ResponseFormatter` (Output formatting)
    - `ErrorHandler` (Error wrapping)
    - `SafetyValidator` (Security checks)
    - `CONFIG` (Constants)

## Patterns to Follow
- **Tool Definition**: `export const tools = { tool_name: { description, inputSchema, handler } }`
- **Error Handling**: Wrap handlers in `ErrorHandler.wrap(async () => { ... })`
- **Validation**: Use `zod` schemas for input and `SafetyValidator` for sensitive ops.
- **Command Execution**: Use `CommandExecutor.adb/fastboot/shell`.
- **Response Formatting**: Use `ResponseFormatter.format/success/warning`.
- **Async/Await**: Ensure all I/O is async where possible.

## Recommended Approach

### Phase 1: Performance Quick Wins (P0)
1.  **Parallel Device Discovery**: Modify `DeviceManager.listDevices` to use `Promise.allSettled` for ADB and Fastboot checks.
2.  **Batch Device Info**: In `tools/device.ts` -> `get_device_info`, combine multiple `shell` calls into a single command string with separators (e.g., `echo "|||";`). Parse the output by splitting on the separator.
3.  **Increase Cache TTL**: Update `DEVICE_CACHE_TTL` in `src/config.ts` to `30000`.

### Phase 2: Performance Improvements (P1)
4.  **Batch Partition Size**: In `tools/flash.ts` -> `list_partitions`, replace the loop of `blockdev` calls with a shell script loop: `for p in /dev/block/by-name/*; do echo "$(basename $p):$(blockdev --getsize64 $p)"; done`.
5.  **Streaming File Hash**: In `tools/flash.ts` -> `dump_partition`, replace `fs.readFileSync` with `fs.createReadStream` and pipe to hash update.
6.  **Async Screenshot Base64**: In `tools/interaction.ts` -> `capture_screenshot`, use `fs.promises.readFile`.

### Phase 3: High-Value Features (P2)
7.  **`dump_ui_hierarchy`**: Add to `tools/interaction.ts`. Use `uiautomator dump`.
8.  **`get_recent_crashes`**: Add to `tools/device.ts`. Use `logcat -b crash` and `ls /data/tombstones`. Handle permission errors gracefully.
9.  **`forward_port`**: Add to `tools/device.ts`. Use `adb forward`.

### Phase 4: Token Efficiency (P3)
10. **Trim Tool Descriptions**: Review all tool descriptions in `src/tools/*.ts` and condense them. Remove redundant examples if schema covers it.

## Risks & Considerations
- **Batching Shell Commands**: Ensure the separator is unique and won't appear in normal output. `echo "---SECTION---"` should be safe.
- **Permission Issues**: accessing `/data/tombstones` usually requires root. The tool should handle non-rooted devices gracefully (e.g., return what is accessible or a helpful message).
- **Device Compatibility**: `uiautomator` might not be present on very old devices or custom ROMs without GApps.
- **Output Parsing**: When batching, ensure regex or string splitting is robust against empty outputs or errors in sub-commands.
