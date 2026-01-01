# Phase 1: Research

## Objective
Thoroughly analyze the codebase to prepare for the implementation phase.
Your findings will be used by Claude in Phase 2.

## Original Task
# Android Debug MCP Server - Performance & Features Optimization

## Objective

Make this MCP server **super useful** and **super responsive** by optimizing performance bottlenecks and adding high-value features.

## Completion Promise

> "All P0 and P1 optimizations are implemented, tests pass, and the server is measurably faster."

## Task Breakdown

### Phase 1: Performance Quick Wins (P0)

1. **Parallel Device Discovery** - `src/utils/device-manager.ts:26-43`
   - Use `Promise.allSettled()` to run ADB and Fastboot device discovery concurrently
   - Expected improvement: 50% faster device listing

2. **Batch Device Info Commands** - `src/tools/device.ts:126-189`
   - Combine 6 sequential shell calls into 1-2 batched commands
   - Use single script: `getprop; dumpsys battery; ip addr show wlan0`
   - Expected improvement: 3-6s → <1s

3. **Increase Cache TTL** - `src/config.ts:21`
   - Change `DEVICE_CACHE_TTL` from 5000ms to 30000ms
   - Reduces redundant device discovery

### Phase 2: Performance Improvements (P1)

4. **Batch Partition Size Queries** - `src/tools/flash.ts:740-773`
   - Replace N+1 queries with single batch command
   - `for p in /dev/block/by-name/*; do echo "$(basename $p):$(blockdev --getsize64 $p)"; done`
   - Expected improvement: 10-30s → <2s

5. **Streaming File Hash** - `src/tools/flash.ts:1043-1048`
   - Replace `fs.readFileSync()` with streaming hash
   - Use `fs.createReadStream()` + `crypto.createHash()` pipeline
   - Fixes OOM risk for large partitions (2GB+)

6. **Async Screenshot Base64** - `src/tools/interaction.ts:161-163`
   - Replace `fs.readFileSync()` with `fs.promises.readFile()`

### Phase 3: High-Value Features (P2)

7. **Add `dump_ui_hierarchy` Tool** - New file or add to `interaction.ts`
   - Command: `uiautomator dump /sdcard/ui.xml && cat /sdcard/ui.xml`
   - Returns XML view hierarchy for UI automation
   - Enables reliable element finding vs blind coordinate tapping

8. **Add `get_recent_crashes` Tool** - New file or add to `device.ts`
   - Collect tombstones: `ls -la /data/tombstones/`
   - Collect crash logs: `logcat -b crash -d`
   - Essential for debugging

9. **Add `forward_port` Tool** - Add to `device.ts`
   - Command: `adb forward tcp:LOCAL tcp:REMOTE`
   - Enable network debugging

### Phase 4: Token Efficiency (P3)

10. **Trim Tool Descriptions**
    - Reduce verbose tool schemas from 500+ tokens to <200 tokens each
    - Remove redundant examples from `inputSchema` objects
    - Keep descriptions concise

## Verification

After each change:
1. Run `npm run build` - must pass
2. Run `npm run lint` - must pass
3. Test affected tool manually if possible

## Files to Modify

- `src/utils/device-manager.ts` - Parallel discovery
- `src/tools/device.ts` - Batch info, port forwarding, crashes
- `src/tools/flash.ts` - Batch partition sizes, streaming hash
- `src/tools/interaction.ts` - UI hierarchy, async base64
- `src/config.ts` - Cache TTL

## Do NOT

- Rewrite in Rust/Go (bottleneck is ADB, not TypeScript)
- Add Streamable HTTP transport (overkill for Claude Desktop)
- Over-engineer with connection pooling
- Break existing functionality

## Research Tasks

1. **File Inventory**: List all files relevant to this task
2. **Dependency Mapping**: Document how components connect
3. **Pattern Analysis**: Note existing conventions to follow
4. **Risk Assessment**: Identify potential issues
5. **Approach Design**: Recommend step-by-step implementation

## Output

Create `.agent/research-findings.md` with this structure:

```markdown
# Research Findings

## Relevant Files
| File | Purpose | Needs Changes |
|------|---------|---------------|

## Dependencies
- Component relationships
- External libraries

## Patterns to Follow
- Naming conventions
- Code organization
- Existing abstractions

## Recommended Approach
1. Step 1
2. Step 2
...

## Risks & Considerations
- Potential issues
- Things to watch for
```

## Success Criteria
- [ ] All relevant files documented in .agent/research-findings.md
- [ ] Dependencies mapped
- [ ] Approach recommended
- [ ] PHASE_COMPLETE

---
Research phase only. Implementation will be done by Claude in Phase 2.

## Implementation Progress

### Completed (Phase 2)
- [x] P0: Parallel Device Discovery - commit `236b598`
- [x] P0: Batch Device Info Commands - commit `f935288`
- [x] P0: Increase Cache TTL - commit `9b07391`
- [x] P1: Batch Partition Size Queries - already implemented in original code
- [x] P1: Streaming File Hash - commit `e626e58` (replaced `fs.readFileSync` with streaming hash)
- [x] P1: Async Screenshot Base64 - replaced `fs.readFileSync()` with `fs.promises.readFile()`
- [x] P2: Add `dump_ui_hierarchy` tool - commit `0c71e27` (uiautomator dump for UI automation)

### In Progress
- [ ] P2: Add `forward_port` tool
- [ ] P3: Trim Tool Descriptions

### Just Completed This Iteration
- [x] P2: Add `get_recent_crashes` tool - commit pending (collects crash logs, tombstones, ANR traces)
