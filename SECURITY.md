# Security Policy

## Supported Versions

We release patches for security vulnerabilities for the following versions:

| Version | Supported          |
| ------- | ------------------ |
| 0.1.x   | :white_check_mark: |

## Security Features

The Android Debug MCP Server includes several security features:

### Input Validation
- All tool inputs are validated using Zod schemas
- Shell commands are sanitized to prevent command injection
- File paths are validated to prevent directory traversal
- Package names are validated against regex patterns
- Partition names are restricted to a whitelist

### Confirmation Tokens
Destructive operations require time-limited confirmation tokens:
- `unlock_bootloader` - Wipes all data
- `lock_bootloader` - Wipes all data
- `flash_partition` - Overwrites partition
- `erase_partition` - Deletes partition data
- `format_partition` - Formats partition
- `flash_all` - Complete device wipe

Tokens must be generated within 60 seconds and follow format:
```
CONFIRM_<OPERATION>_<timestamp>
```

### Command Execution Safety
- Shell metacharacters blocked in `execute_shell()` tool
- High-risk commands (rm, dd, format, etc.) are blocked
- Timeouts prevent hung operations
- Device authorization required

## Reporting a Vulnerability

**Please do not report security vulnerabilities through public GitHub issues.**

### How to Report

Send security vulnerability reports to: **[Your email or security contact]**

Include in your report:
- **Description** of the vulnerability
- **Steps to reproduce** the issue
- **Potential impact** assessment
- **Suggested fix** (if available)
- Your contact information for follow-up

### What to Expect

1. **Acknowledgment**: Within 48 hours of report
2. **Initial Assessment**: Within 5 business days
3. **Updates**: At least weekly until resolved
4. **Resolution Timeline**: 
   - Critical: 7-14 days
   - High: 30 days
   - Medium: 60 days
   - Low: 90 days

### Disclosure Policy

- **Private disclosure**: We will work with you to understand and fix the issue
- **Public disclosure**: After a fix is available and users have had time to update (typically 30 days)
- **Credit**: We will credit you in release notes (unless you prefer anonymity)

## Known Security Considerations

### By Design

The following are **intentional design decisions** and not security vulnerabilities:

1. **Shell Command Execution**: The `execute_shell()` tool allows shell commands by design, but includes:
   - Command sanitization
   - Metacharacter blocking
   - High-risk command blocking
   - Clear warnings in documentation

2. **Destructive Operations**: Tools like `unlock_bootloader` and `flash_partition` are dangerous by nature:
   - Require confirmation tokens
   - Show prominent warnings
   - Documented safety requirements
   - Only accessible through explicit tool calls

3. **File System Access**: Tools can access device file system:
   - Limited to connected device
   - Requires USB debugging authorization
   - Path traversal protection included
   - No access to host file system beyond specified paths

### Recommended Security Practices

For users deploying this server:

1. **Trust the LLM**: Only use with trusted AI models
2. **Review Commands**: Understand what operations will be performed
3. **Test Devices**: Use on non-production devices first
4. **Backup Data**: Always backup before destructive operations
5. **Network Security**: Be cautious with wireless ADB on untrusted networks
6. **Access Control**: Restrict who can access Claude Desktop or the MCP server

### Out of Scope

The following are **out of scope** for security reports:

- Issues in ADB/Fastboot binaries (report to Google)
- Android device vulnerabilities (report to device manufacturer)
- MCP SDK vulnerabilities (report to Anthropic)
- Social engineering attacks
- Physical device security
- Attacks requiring physical access to host machine
- Issues requiring user to explicitly execute dangerous commands with confirmation tokens

## Security Updates

Security patches will be released as:
- **Patch versions** (0.1.x) for minor security fixes
- **Minor versions** (0.x.0) for significant security improvements
- Release notes will indicate security-related changes

Subscribe to releases on GitHub to receive notifications.

## Responsible Disclosure Hall of Fame

We thank the following researchers for responsibly disclosing security issues:

*(No reports yet)*

---

## Questions?

For non-security questions, please use:
- GitHub Issues for bugs
- GitHub Discussions for questions

For security concerns, please email: **[Your security contact]**

## Additional Resources

- [OWASP Command Injection](https://owasp.org/www-community/attacks/Command_Injection)
- [CWE-78: OS Command Injection](https://cwe.mitre.org/data/definitions/78.html)
- [Android Debug Bridge (ADB)](https://developer.android.com/tools/adb)

---

**Last Updated**: October 17, 2025

