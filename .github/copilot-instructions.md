# Copilot Instructions for mcp-dependencies

## Project Overview
This is a Node.js TypeScript monorepo that discovers MCP (Model Context Protocol) server configurations and APM (Agent Package Manager) manifests, then submits them to GitHub's Dependency Graph.

## Monorepo Structure
- `packages/core` — shared discovery and conversion logic (the source of truth)
- `packages/cli` — thin CLI wrapper using Commander.js  
- `packages/vscode-extension` — VS Code extension using the core package

## Key Principles
- **All scanning/parsing logic lives in `packages/core`** — never duplicate it in cli or extension
- **Cross-platform**: always use `path` module, `os.homedir()`, `process.platform` for paths
- **No network calls** in discovery (static analysis only in v1)
- **No side effects**: never execute MCP server commands, only read config files
- **Deterministic output**: always sort results by name/id for reproducible output

## TypeScript/Build
- Target: ES2020, module: Node16, strict mode enabled
- Root `tsconfig.base.json` extended by each package
- `npm workspaces` for dependency management
- Run `npm run build` at root to build all packages
- Run `npm run test --workspace packages/core` for core tests (Vitest)

## Testing
- Tests live in `packages/core/tests/`
- Fixture files in `packages/core/tests/fixtures/`
- Add fixture files for new formats; test all parsers

## Error Handling
- Never throw from parsers — accumulate `ScanDiagnostic[]` instead
- Missing files: `level: "error"` for required files, silent return for optional files (e.g., lockfile, global settings.json)
- Always continue scanning other files when one fails

## Adding New Manifest Formats
1. Add parser to `packages/core/src/parsers/`
2. Export from `packages/core/src/index.ts`
3. Call from `packages/core/src/discover.ts`
4. Add fixture and test
