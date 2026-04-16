# Contributing to Sentinel SDK

Thank you for your interest in contributing to the Sentinel SDK! This document provides guidelines and instructions for contributing.

## Code of Conduct

Be respectful, constructive, and professional. We're building developer tools together.

## Getting Started

### Prerequisites

- Node.js 18.0.0 or higher
- npm or yarn
- Git

### Setup

1. Fork the repository
2. Clone your fork:
   ```bash
   git clone https://github.com/YOUR_USERNAME/sentinel-sdk-node.git
   cd sentinel-sdk-node
   ```

3. Install dependencies:
   ```bash
   npm install
   ```

4. Create a branch:
   ```bash
   git checkout -b feature/your-feature-name
   ```

## Development Workflow

### Running Tests

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run tests with coverage
npm run test:coverage
```

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run lint:fix
```

### Formatting

```bash
npm run format
```

### Building

```bash
npm run build
```

## Testing Guidelines

### Writing Tests

- Write tests for all new features
- Maintain >80% code coverage
- Use descriptive test names
- Group related tests with `describe` blocks

Example:

```typescript
describe('Sentinel.track()', () => {
  it('should execute function and track result', async () => {
    // Test implementation
  });

  it('should track failures', async () => {
    // Test implementation
  });
});
```

### Test Structure

- Unit tests: `src/**/*.test.ts`
- Integration tests: Tag with `@tag :integration`
- Mock external dependencies (fetch, etc.)

## Pull Request Process

1. **Update documentation** - Update README.md if you add features
2. **Add tests** - Ensure your code is well-tested
3. **Update CHANGELOG** - Add an entry under `[Unreleased]`
4. **Ensure CI passes** - All tests, linting, and type checks must pass
5. **Request review** - Tag maintainers for review

### PR Title Format

Use conventional commits:

- `feat: Add streaming support`
- `fix: Handle timeout errors correctly`
- `docs: Update installation instructions`
- `test: Add tests for error handling`
- `chore: Update dependencies`

### PR Description Template

```markdown
## Description
Brief description of changes

## Type of Change
- [ ] Bug fix
- [ ] New feature
- [ ] Breaking change
- [ ] Documentation update

## Testing
How was this tested?

## Checklist
- [ ] Tests added/updated
- [ ] Documentation updated
- [ ] CHANGELOG.md updated
- [ ] Types updated (if applicable)
```

## Code Style

### TypeScript

- Use TypeScript strict mode
- Define types for all public APIs
- Avoid `any` - use `unknown` if type is truly unknown
- Document public methods with JSDoc

### Naming Conventions

- Classes: `PascalCase`
- Methods/functions: `camelCase`
- Constants: `UPPER_SNAKE_CASE`
- Interfaces: `PascalCase` (no `I` prefix)
- Private properties: `camelCase` (no `_` prefix)

### Documentation

- Document all public APIs with JSDoc
- Include examples in JSDoc for complex methods
- Keep comments concise and clear

Example:

```typescript
/**
 * Track an LLM call with cost tracking and budget enforcement
 * 
 * @param fn - Async function that executes the LLM call
 * @param opts - Tracking options
 * @returns Result from the tracked function
 * @throws {BudgetExceededError} When budget is exceeded
 * 
 * @example
 * ```typescript
 * const result = await sentinel.track(
 *   async () => anthropic.messages.create({...}),
 *   { model: 'claude-sonnet-4', budget_cents: 50 }
 * );
 * ```
 */
async track<T>(fn: () => Promise<T>, opts: TrackOptions): Promise<T>
```

## Project Structure

```
sentinel-sdk-node/
├── src/
│   ├── index.ts           # Main SDK code
│   └── index.test.ts      # Test suite
├── examples/
│   └── basic-usage.ts     # Example code
├── dist/                  # Compiled output (gitignored)
├── coverage/              # Test coverage (gitignored)
├── package.json
├── tsconfig.json
├── jest.config.js
└── README.md
```

## Release Process

1. Update version in `package.json`
2. Update `CHANGELOG.md`
3. Create git tag: `git tag v0.1.0`
4. Push tag: `git push origin v0.1.0`
5. Publish to npm: `npm publish`

## Questions?

- Open an issue for bugs or feature requests
- Tag maintainers for questions
- Check existing issues before creating new ones

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
