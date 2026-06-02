# mcp-dependencies

> Discover MCP server configurations and APM manifests, then report them to GitHub's Dependency Graph.

## Overview

This monorepo contains tooling to automatically discover [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server configurations and [APM (Agent Package Manager)](https://github.com/microsoft/apm) manifests across your project and global VS Code settings. Discovered dependencies are converted to GitHub's [Dependency Submission API](https://docs.github.com/en/rest/dependency-graph/dependency-submission) snapshot format, enabling Dependabot alerts and the Dependency Graph to cover AI/agent tooling.

## Packages

| Package | Description |
|---|---|
| [`@mcp-dependencies/core`](packages/core) | Shared discovery and conversion logic |
| [`@mcp-dependencies/cli`](packages/cli) | CLI tool (`mcp-apm-scan`) |
| [`mcp-dependencies` (VS Code)](packages/vscode-extension) | VS Code extension |

## CLI Usage

```bash
# Install globally
npm install -g @mcp-dependencies/cli

# Discover MCP and APM dependencies in the current directory
mcp-apm-scan discover

# Save discovery results to a file
mcp-apm-scan discover -o discovered.json

# Convert discovery JSON to a GitHub Dependency Submission snapshot
mcp-apm-scan convert discovered.json -o snapshot.json

# One-shot: discover + convert to snapshot
mcp-apm-scan scan -o snapshot.json

# Include global VS Code user config
mcp-apm-scan scan --global
```

## GitHub Actions Example

```yaml
- name: Scan MCP/APM dependencies
  run: |
    npx @mcp-dependencies/cli scan \
      --sha "$GITHUB_SHA" \
      --ref "$GITHUB_REF" \
      -o snapshot.json

- name: Submit dependency snapshot
  uses: actions/dependency-review-action@v4
  # Or submit via curl:
  # curl -X POST "https://api.github.com/repos/$GITHUB_REPOSITORY/dependency-graph/snapshots" \
  #   -H "Authorization: token $GITHUB_TOKEN" \
  #   -H "Content-Type: application/json" \
  #   -d @snapshot.json
```

## What Gets Discovered

### MCP Servers
- **Workspace-level**: `.vscode/mcp.json` in the project
- **VS Code workspace settings**: `.vscode/settings.json` with `mcp.servers`
- **Global user config** (opt-in): VS Code user `mcp.json` or `settings.json` on Windows, macOS, and Linux

### APM Dependencies
- `apm.yml` — declared dependencies (skills, plugins, packages, MCP servers via APM)
- `apm.lock.yaml` — resolved versions from the lockfile

## Output Schema

```json
{
  "mcpServers": [
    {
      "name": "playwright",
      "source": "workspace",
      "location": ".vscode/mcp.json",
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@microsoft/mcp-server-playwright"],
      "ecosystem": "npm",
      "packageName": "@microsoft/mcp-server-playwright",
      "version": null
    }
  ],
  "otherDependencies": [
    {
      "id": "microsoft/apm-sample-package",
      "type": "apm-package",
      "version": "v1.0.0",
      "source": "apm.yml"
    }
  ],
  "diagnostics": []
}
```

## Development

```bash
# Install dependencies
npm install

# Build all packages
npm run build

# Run tests (core)
npm run test --workspace packages/core

# Lint
npm run lint
```

## Architecture

See [ADRs/001-ProjectStart.md](ADRs/001-ProjectStart.md) for the full design specification.

## License

[MIT](LICENSE)
