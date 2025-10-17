# Contributing to Android Debug MCP Server

Thank you for your interest in contributing to the Android Debug MCP Server! This document provides guidelines and instructions for contributing.

## Code of Conduct

This project follows the [Contributor Covenant Code of Conduct](https://www.contributor-covenant.org/version/2/1/code_of_conduct/). By participating, you are expected to uphold this code. Please report unacceptable behavior to the project maintainers.

## How to Contribute

### Reporting Bugs

Before creating bug reports, please check the existing issues to avoid duplicates. When creating a bug report, include:

- **Clear title and description**
- **Steps to reproduce** the issue
- **Expected behavior** vs actual behavior
- **Environment details**:
  - Node.js version
  - Operating system
  - Android device details
  - ADB/Fastboot version
- **Error messages** and logs
- **Screenshots** if applicable

### Suggesting Enhancements

Enhancement suggestions are welcome! Please provide:

- **Clear description** of the enhancement
- **Use case** explaining why it would be useful
- **Examples** of how it would work
- **Potential implementation** approach (optional)

### Pull Requests

1. **Fork** the repository
2. **Create a branch** from `main`:
   ```bash
   git checkout -b feature/your-feature-name
   ```
3. **Make your changes** following our coding standards
4. **Test your changes** thoroughly
5. **Commit** with clear, descriptive messages
6. **Push** to your fork
7. **Submit a pull request** with a comprehensive description

#### Pull Request Guidelines

- Follow the existing code style
- Update documentation for any changed functionality
- Add tests for new features (when test infrastructure exists)
- Ensure TypeScript compilation succeeds (`npm run build`)
- Run type checking (`npm run type-check`)
- Run linting (`npm run lint`)
- Update `CHANGELOG.md` with your changes

## Development Setup

### Prerequisites

- Node.js 18 or later
- npm or yarn
- Android Platform Tools (ADB & Fastboot)
- Android device for testing

### Initial Setup

```bash
# Clone your fork
git clone https://github.com/yourusername/android-debug-mcp-server.git
cd android-debug-mcp-server

# Install dependencies
npm install

# Build the project
npm run build

# Run type checking
npm run type-check

# Run linting
npm run lint
```

### Development Workflow

```bash
# Watch mode for development
npm run watch

# In another terminal, test the server
npm run start
```

## Coding Standards

### TypeScript

- Use **strict TypeScript** configuration
- Define types for all function parameters and return values
- Avoid `any` type unless absolutely necessary
- Use modern ES6+ features (async/await, arrow functions, etc.)

### Code Style

- **Indentation**: 2 spaces
- **Line length**: Aim for 100 characters maximum
- **Quotes**: Single quotes for strings
- **Semicolons**: Required
- **Naming conventions**:
  - Classes: PascalCase
  - Functions/methods: camelCase
  - Constants: UPPER_SNAKE_CASE
  - Files: kebab-case.ts

### Documentation

- Add JSDoc comments for all public functions and classes
- Document parameters, return values, and exceptions
- Include usage examples for complex functions
- Update README.md for user-facing changes

### Error Handling

- Use the `ErrorHandler` utility for consistent error messages
- Provide actionable error messages with suggestions
- Validate all inputs using Zod schemas
- Use `SafetyValidator` for security-sensitive operations

### Security

- **Never** execute unsanitized user input
- Validate all file paths to prevent directory traversal
- Use confirmation tokens for destructive operations
- Follow principle of least privilege
- Report security vulnerabilities privately (see SECURITY.md)

## Project Structure

```
android-debug-mcp-server/
├── src/
│   ├── config.ts           # Configuration constants
│   ├── index.ts            # Entry point
│   ├── server.ts           # MCP server setup
│   ├── types.ts            # TypeScript type definitions
│   ├── tools/              # MCP tool implementations
│   │   ├── app.ts          # App management tools
│   │   ├── device.ts       # Device management tools
│   │   ├── file.ts         # File operation tools
│   │   └── flash.ts        # Flashing/rooting tools
│   └── utils/              # Utility modules
│       ├── device-manager.ts
│       ├── error-handler.ts
│       ├── executor.ts
│       ├── formatter.ts
│       └── validator.ts
├── dist/                   # Compiled output (generated)
├── docs/                   # Additional documentation
└── evaluation/             # Test scenarios
```

## Adding New Tools

When adding a new MCP tool:

1. **Define Zod schema** for input validation
2. **Implement handler** with proper error handling
3. **Add to tool registry** in appropriate file (app.ts, device.ts, etc.)
4. **Document the tool** with:
   - Clear description
   - Parameter details
   - Usage examples
   - Safety warnings if applicable
5. **Update README.md** with the new tool
6. **Add to CHANGELOG.md**

### Tool Implementation Template

```typescript
export const MyToolSchema = z.object({
  device_id: z.string().describe('Device ID from list_devices()'),
  param: z.string().describe('Description')
}).strict();

export const myTools = {
  my_tool: {
    description: `Brief description.
    
Detailed explanation...

Examples:
- my_tool(device_id="ABC123", param="value")`,
    inputSchema: {
      type: 'object' as const,
      properties: {
        device_id: {
          type: 'string' as const,
          description: 'Device ID from list_devices()'
        },
        param: {
          type: 'string' as const,
          description: 'Description'
        }
      },
      required: ['device_id', 'param']
    },
    handler: async (args: z.infer<typeof MyToolSchema>) => {
      return ErrorHandler.wrap(async () => {
        await DeviceManager.validateDevice(args.device_id);
        // Implementation
        return ResponseFormatter.success('Success message', data);
      });
    }
  }
};
```

## Testing

Currently, the project does not have automated tests. Contributions to add a test suite would be very welcome!

### Manual Testing Checklist

Before submitting a PR, test:

- [ ] Tool works with real Android device
- [ ] Error handling works correctly
- [ ] Input validation catches invalid inputs
- [ ] Documentation is accurate
- [ ] No TypeScript errors
- [ ] No linter warnings

## Release Process

(For maintainers)

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Commit changes
4. Create git tag: `git tag v0.x.x`
5. Push tag: `git push origin v0.x.x`
6. Publish to npm: `npm publish`
7. Create GitHub release with changelog

## Questions?

- **General questions**: Open a GitHub Discussion
- **Bug reports**: Open a GitHub Issue
- **Security issues**: See SECURITY.md
- **Feature requests**: Open a GitHub Issue with "enhancement" label

## License

By contributing, you agree that your contributions will be licensed under the MIT License.

## Recognition

Contributors will be acknowledged in release notes and the project README.

---

Thank you for contributing to Android Debug MCP Server! 🚀
