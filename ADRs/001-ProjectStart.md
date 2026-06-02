# Design Specification: MCP & APM Dependency Discovery and Submission Tool

## Overview and Goals

This document outlines a design specification for an **open-source tool** that automatically discovers **MCP (Model Context Protocol) configuration files** and **APM (Agent Package Manager) manifests** across various environments, then **converts the discovered data into a format compatible with GitHub’s Dependency Submission API** for consumption by GitHub’s Dependency Graph and related security/update features.

**Key objectives include:**

* **Automated Discovery**: Locate **`mcp.json`** configurations and **APM** manifests (`apm.yml` and lockfiles) both in the **current project** and in well-known **global user directories**, across **Windows, macOS, and Linux**.
* **Unified Output**: Aggregate discovered **MCP server configurations** and **APM dependencies** into a **structured JSON** output, separating **MCP servers** from other APM dependencies.
* **Dependency Graph Integration**: Provide functionality to **translate** the discovered dependencies into a **GitHub Dependency Submission API snapshot** format. This enables integration with GitHub’s security alerting and update notifications via the Dependency Graph.
* **Code Reuse for IDE Integration**: A companion **Visual Studio Code extension** will reuse the same discovery logic to provide developers immediate insight into their repository’s MCP/APM dependencies, ensuring consistency between local analysis and CI/CD pipelines.

**Non-Goals (Initial Version):**

* This tool will **not** perform actual vulnerability analysis, direct security alerting, or automatic dependency updates (e.g. via Dependabot). Its role is discovery and reporting of dependencies; it assumes GitHub’s ecosystem and future enhancements will handle vulnerability and update alerts.
* It will **not** parse or report on dependencies outside of MCP and APM manifest formats (no generic package scanning for languages like Java, Python, etc., as those are handled by existing tools).
* While the tool may have an option to resolve online APM package references for deeper analysis, by default it will **not require network access** – focusing on local files.
* **APM dependency resolution** beyond static parsing (e.g., actually cloning repos to parse nested APM manifests) is **not in the initial scope**, but is noted for future work.

***

## 1. Node.js CLI Tool for MCP & APM Discovery

### 1.1 Purpose and Features

The CLI tool (“**mcp-apm-scan**” for design reference) will **scan local directories** for MCP and APM config files and output discovered dependency information as structured JSON. Key behavior and features:

* **Cross-Platform**: Implemented in Node.js (TypeScript), ensuring compatibility with Windows, macOS, and Linux.
* **MCP Config Discovery**: Find **MCP server configuration files**:
  * **Workspace-level**: Typically in the current project’s `.vscode/mcp.json` (which is a JSON file in the VS Code settings folder of the project).
  * **Global-level**: Identify **well-known VS Code global user settings** where `mcp.json` or equivalent MCP server configurations are stored (e.g., VS Code’s user profile settings on each OS). For instance:
    * Windows: likely `%APPDATA%\Code\User\mcp.json` or as part of `settings.json` (where the user’s settings include a `"mcp.servers"` entry).
    * macOS: `~/Library/Application Support/Code/User/mcp.json` or user settings.
    * Linux: `~/.config/Code/User/mcp.json` or user settings.
  * Support scanning these locations by default (and possibly additional common editor-specific MCP config, e.g., `.mcp.json` at solution root for Visual Studio).
  * **Output** each discovered MCP server configuration as a structured JSON **entry**, capturing relevant fields (server name, type, connection details).
* **APM Manifest Discovery**: Find **APM manifests** (`apm.yml`) and **APM lockfiles** (`apm.lock.yaml`) in the current project (and optionally, known global locations if any such usage emerges).
  * **APM dependency extraction**: Parse `apm.yml` to retrieve:
    * **APM packages**: Entries under `dependencies.apm` (which may reference skills, plugins, or other APM packages by repository or package coordinates).
    * **MCP servers via APM**: If `dependencies.mcp` exists in `apm.yml`, those are presumably MCP server specs (with fields like name, transport, command, etc.). Each such entry corresponds to a server that should be included in the MCP servers list.
  * **Dependency resolution**: For each APM dependency referencing a **GitHub repository or package**, the CLI will (in initial version) list the reference **as given** (owner/repo, optional version or commit) without fully cloning or resolving it. Optionally, a future enhancement could allow the CLI to fetch these references (if online) to find nested `apm.yml` or `mcp.json` inside them, but this is beyond initial scope (see *Extensibility*).
* **JSON Output**: Consolidate all findings into a single structured JSON object with two primary sections:
  * **`mcpServers`**: An array of discovered MCP server configurations (from either direct `mcp.json` files or from APM’s `mcp` manifest entries).
  * **`otherDependencies`**: An array of other discovered dependencies (APM packages, skills, plugins, etc., essentially anything from `apm.yml` that is not an MCP server).

### 1.2 JSON Output Schema and Example

The CLI’s output JSON provides a clear schema to facilitate further processing (e.g. conversion to the GitHub dependency format). Key fields for each entry include:

* For **MCP servers** (`mcpServers` list):
  * `name`: Unique identifier or name of the MCP server (as defined in the config).
  * `source`: Location of the config (e.g., `"workspace"` for a local `.vscode/mcp.json`, `"user"` for global config, or `"apm"` if sourced via an APM manifest).
  * `location`: File path where this was found, if applicable (e.g., `".vscode/mcp.json"` or `"/User/settings"`).
  * `type`: Connection type (`"stdio"`, `"http"`, etc.).
  * `command` & `args`: For stdio servers, the launch command and arguments (often reveals an external package or binary tool).
  * `url`: For HTTP servers, the endpoint URL.
  * **Inferred dependency info**: If the MCP config references an external package (for example, a Node package in the `command` or `args`), include fields like `ecosystem` (e.g., `"npm"`), `packageName`, and `version` (if explicitly pinned; otherwise possibly `null` or `"latest"`).
  * Additional context (optional): e.g., environment variables or sandbox flags if present, though these are typically not relevant for dependency tracking.

* For **Other APM dependencies** (`otherDependencies` list):
  * `id`: A reference identifier for the dependency:
    * For **APM package** dependencies, this could be a string like `"microsoft/apm-sample-package#v1.0.0"` (owner/repo#version or a package name).
    * For **skills, plugins, or agent scripts**, it could be a path reference (e.g., `"anthropics/skills/skills/frontend-design"` or `"github/awesome-copilot/plugins/context-engineering"`).
  * `type`: A categorization such as `"apm-package"`, `"apm-skill"`, `"apm-plugin"`, etc., based on the location or format of the dependency.
  * `version`: If a version or commit is specified (for example, `#v1.0.0`, `#commitSHA` in the reference), include it; otherwise mark as `null` or `"latest"`.
  * Additional fields as needed, e.g., `source` (likely always the APM manifest file path for these entries), or resolved information if available.

**Example Output** (simplified for illustration):

```json
{
  "mcpServers": [
    {
      "name": "playwright",
      "source": "workspace",
      "location": "./.vscode/mcp.json",
      "type": "stdio",
      "command": "npx",
      "args": ["-y", "@microsoft/mcp-server-playwright"],
      "ecosystem": "npm",
      "packageName": "@microsoft/mcp-server-playwright",
      "version": null
    },
    {
      "name": "github",
      "source": "workspace",
      "location": "./.vscode/mcp.json",
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp"
    },
    {
      "name": "io.github.github/github-mcp-server",
      "source": "apm",
      "location": "./apm.yml",
      "type": "http",
      "url": "https://api.githubcopilot.com/mcp",
      "ecosystem": null
    }
  ],
  "otherDependencies": [
    {
      "id": "anthropics/skills/skills/frontend-design",
      "type": "apm-skill",
      "version": null
    },
    {
      "id": "github/awesome-copilot/plugins/context-engineering",
      "type": "apm-plugin",
      "version": null
    },
    {
      "id": "microsoft/apm-sample-package",
      "type": "apm-package",
      "version": "v1.0.0"
    }
  ]
}
```

*In this example: one MCP server is discovered from the `.vscode/mcp.json` (Playwright via npm, and GitHub remote server)【1†L45-L54】【7†L62-L63】. Another HTTP server comes from the `apm.yml` (`io.github.github/github-mcp-server`, which is the GitHub MCP server via APM’s manifest). The other dependencies list includes skills, plugins, etc., as referenced in `apm.yml`【4†L38-L46】【4†L58-L66】.*

### 1.3 CLI Usage and Commands

The CLI tool will likely have the following interface:

* **Primary Command**: `discover` (or by default, running the CLI without subcommand triggers discovery):
  * **Function**: Scans the current directory and user config locations to produce the JSON output as described.
  * **Options**:
    * `--output, -o <file>`: specify an output file (otherwise print to stdout).
    * `--include-global`: include scanning of global user config (as default maybe true for local usage; false if running in CI where global user config might not be relevant).
    * Possibly `--skip-lock` or `--no-recursion` to disable any deeper network fetching.
    * Possibly `--verbose` for logs.

* **Conversion Command**: `convert` (or `to-snapshot`):
  * **Function**: Takes the discovery JSON (from a file or piped from `discover`) and converts it to a **GitHub Dependency Submission API snapshot JSON**.
  * **Options**:
    * `--input <file>` (or read from stdin)
    * `--output, -o <file>` for output snapshot JSON.
    * `--format <format>` if we support multiple output formats (e.g., default is GitHub snapshot JSON, but could support direct SBOM export in future).

For convenience, the tool could allow a one-shot command to do both, e.g. `discover --to-snapshot` which combines detection and conversion, but initially separating steps clarifies responsibilities and debugging.

### 1.4 Implementation Notes

* **File System Scanning**: Use Node's `fs` module and perhaps a file globbing library (like `fast-glob`) to efficiently find all potential config files (`mcp.json`, `apm.yml`, `apm.lock.yaml`) in the search scope.
* **YAML/JSON Parsing**: Use robust parsing libraries:
  * JSON: Node’s built-in JSON parse (with error handling for invalid JSON).
  * YAML: e.g. `js-yaml` or similar to parse `apm.yml` (and lockfile if needed).
* **APM Dependencies**: The tool might integrate with the \[APM CLI]\[apm-cli] for complex cases, but it should avoid heavy external dependencies. Instead, focus on directly parsing `apm.yml`. Each entry in `dependencies.apm` can be treated as a string reference (with optional version)【4†L38-L46】:
  * If the format matches `owner/repo/path` or `owner/repo#version`, they denote content from a GitHub repository at a certain version (which could be a skill, plugin, or an APM package).
  * Mark such entries in `otherDependencies` accordingly (we may attempt to infer type by path or context).
  * For initial implementation, we **do not clone or fetch these**; if one of these references is itself an APM package repository, a future version could incorporate its own `apm.yml` scanning (i.e., recursion).
* **Configuration for Known Paths**: Hard-code or detect known global config locations (as above) for each OS. For instance, Node’s `os.homedir()` can help build paths to `.config/Code/User/mcp.json` or equivalent. Provide user override environment variables (like `VSCODE_USER_DIR`) if needed.

***

## 1A. Converting Discovery JSON to GitHub Dependency Submission Format

The tool will provide functionality to transform the discovered dependency output into a **Dependency Submission API snapshot JSON** – the format that GitHub’s \[Dependency Submission API]\[gh-dep-api] expects. This can be implemented as part of the CLI (a subcommand or a distinct utility function).

### 1A.1 Snapshot Mapping Design

* **Manifest**: In the context of the Dependency Graph, we are synthesizing a "manifest" representing our discovered agent configuration. We can, for example, name this manifest `"agent-dependencies"` or derive it from the actual manifest filenames (like `"apm.yml dependencies"`). The snapshot allows multiple manifests, but here one combined manifest might be enough since the scope is specific.
* **Dependency Entries**: Each item (MCP server or other dependency) should be mapped to a **dependency object** in the snapshot’s `dependencies` list. For each:
  * **Package URL (purl)**: If possible, use the <https://github.com/package-url/purl-spec> to encode package identity. For standard ecosystems like npm, use e.g. `pkg:npm/@microsoft/mcp-server-playwright@latest` or with a version if known.
  * **Or Name/Ecosystem**: Alternatively, supply `name`, `version`, and `package_manager` for each dependency. For example,
    * For the Playwright MCP server via npm: `package_manager: "npm"`, `name: "@microsoft/mcp-server-playwright"`, `version: "(none)" or "latest"`.
    * For a skill or plugin from a GitHub repo (no official ecosystem): could use `package_manager: "git"` or `"github"`, with `name: "owner/repo/path"`, `version: "SHA or tag"`; or treat them as a generic "other" category. (GitHub’s API supports a limited set of ecosystems like npm, pip, maven, etc., so non-standard ones may be submitted but will appear as**"Unknown"**).
  * **Scope**: All discovered dependencies are effectively *direct dependencies* of the manifest.
  * **Relationship**: We might not detail transitive relationships in the initial snapshot, as our focus is listing everything discovered (treating them as direct for now). If needed, an `relationship` field can typically denote `direct` or `indirect` in the snapshot.
* **Metadata**:
  * **`version`** (snapshot version): always 0 (the current snapshot schema version).
  * **`job`** (unique job id): generated per run, e.g., use a constant or a timestamp/UUID. If integrated in GitHub Actions, this correlates multiple submissions in one workflow run.
  * **`sha`** (the commit SHA of the codebase scanned): if running in a repository context, the CLI can accept a `--sha` argument or auto-detect via environment (like `GITHUB_SHA` in Actions) to populate this.
  * **`ref`**: optional but can include the branch or tag (like `refs/heads/main`).
  * **`detector`**: identify our tool, e.g., `"name": "mcp-apm-scan", "version": "0.1.0"`.

### 1A.2 Example Conversion Output

For illustration, converting the **Example Output** from section 1.2 into a dependency snapshot could yield something like:

```json
{
  "version": 0,
  "job": "mcpapm-scan-20260602-123456",
  "sha": "<commit-sha-of-repo-if-available>",
  "ref": "refs/heads/main",
  "detector": { "name": "mcpapm-scan", "version": "0.1.0" },
  "manifests": {
    "agent-dependencies": {
      "name": "Agent Configuration Dependencies",
      "file": "apm.yml",
      "resolved": false,
      "dependencies": [
        {
          "package_url": "pkg:npm/%40microsoft/mcp-server-playwright", 
          "relationship": "direct"
        },
        {
          "package_url": "pkg:generic/io.github.github/github-mcp-server"
        },
        {
          "package_url": "pkg:github/anthropics/skills/frontend-design"
        },
        {
          "package_url": "pkg:github/github/awesome-copilot/plugins/context-engineering"
        },
        {
          "package_url": "pkg:github/microsoft/apm-sample-package@v1.0.0"
        }
      ]
    }
  }
}
```

**Notes on this example:**

* `pkg:npm/%40microsoft/mcp-server-playwright` is the \[purl]\[purl-spec] for the npm package **`@microsoft/mcp-server-playwright`**. If we had a version (say 1.2.3), it would be `@1.2.3`. Without a version, it defaults to no version (which in GitHub’s UI will show as an unknown version).
* Other entries are represented with a **generic or GitHub** package URLs, since they don’t belong to a well-known package ecosystem. (GitHub’s dependency graph may list them as generic dependencies, which at least surfaces their presence but might not link to vulnerability data). As the ecosystem evolves (or if GitHub supports an "apm" ecosystem in the future), this mapping can be updated.
* All dependencies are listed under one manifest (`agent-dependencies`). If needed, multiple manifests could be used (for example, separate one for global vs workspace MCP config), but combining them simplifies the snapshot submission.

### 1A.3 Integration Path

The CLI’s `convert` command will produce the above JSON to either console or file, which can then be **submitted to GitHub’s Dependency Submission API**. In a GitHub Actions context, the conversion step can be integrated with a final step to **POST** the JSON to the GitHub API (or easier, use the **Dependency Submission Toolkit** to do so within a custom action)【4†L68-L75】. For local usage, the tool might simply output the snapshot JSON for review or manual submission (or integration with other services like internal security dashboards).

The repository’s README should include a short example similar to the above, demonstrating usage:

```bash
# Discover MCP and APM dependencies and save to JSON
$ mcpapm-scan discover -o discovered-deps.json

# Convert to GitHub Dependency Submission snapshot JSON
$ mcpapm-scan convert discovered-deps.json -o snapshot.json

# (Optionally) Use snapshot in a GitHub Actions step or upload via curl to GitHub API
```

***

## 2. Visual Studio Code Extension (Agent Dependency Scanner)

In addition to the CLI, a **VS Code extension** will be developed to leverage the same discovery logic, enabling developers to analyze their MCP/APM dependencies directly within the editor. This fosters a developer-friendly experience and ensures that any issues can be detected early (like missing MCP servers or outdated APM references).

### 2.1 Extension Architecture & Code Reuse

* **Shared Core Module**: The repository will include a core library or module (in TypeScript) that contains all logic for scanning and producing the discovery JSON. Both the CLI and the VS Code extension will import and use this same code to avoid duplication. This could be structured as an internal package (see **Repository Structure** below).
* **Extension Activation**: The extension will activate on events such as:
  * Opening a workspace that contains an `apm.yml` or `.vscode/mcp.json` (via pattern in `activationEvents` like `workspaceContains:.vscode/mcp.json` and `workspaceContains:apm.yml`).
  * Or a bespoke **VS Code Command** (from the Command Palette) like `"MCP/APM: Scan Dependencies"` that a user can invoke manually.
* **Operation**: Upon activation or invocation, the extension:
  1. Runs the shared discovery function on the workspace folder (and possibly, if permitted by user settings, on global config).
  2. Receives the JSON results (as defined above for the CLI).
  3. **Presentation** of results:
     * Initially, the extension can open a **read-only JSON document** or use an **Output Channel** to display the results of the scan for the user to inspect.
     * Eventually, a more user-friendly UI could be provided, e.g., a **TreeView** in the Explorer sidebar showing:
       * “MCP Servers” node with sub-items for each server (displaying name and maybe a status or version).
       * “APM Dependencies” node listing other dependencies.
     * If relevant, integrate with VS Code’s **problem matcher** or **diagnostics** (for example, flagging if a referenced dependency is missing or cannot be resolved).
* **No Duplicate Logic**: The extension code will *not implement scanning logic independently*; it will depend on the core scanning module (possibly via an NPM package or local project reference). This guarantees that the CLI and extension produce identical results given the same input.

### 2.2 Security and Permissions

* The extension will only read files within the workspace and possibly VS Code’s global settings. It won’t send data externally by itself (unless the user triggers submission through other means).
* If we integrate a feature to directly submit dependency data to GitHub from VS Code, this would require user’s GitHub credentials or a PAT, which is complex. This is out-of-scope in the initial design – the extension’s purpose is local visibility and verifying the data that would go to the CI.

***

## 3. Repository Structure and Technologies

To accommodate both a CLI tool and a VS Code extension, the repository will be structured as a **monorepo** with separate packages for each component, sharing common code. Using a **Node.js + TypeScript** stack for all parts ensures consistency and reusability.

**Proposed Layout:**

```
/ (root)
├── packages/
│   ├── core/                # Core library: discovery logic, JSON schemas, conversion functions
│   ├── cli/                 # CLI tool code (depends on core)
│   └── vscode-extension/    # VS Code extension (depends on core)
├── tests/                   # Shared test cases (could have subfolders per package)
├── docs/                    # Additional documentation, design specs, etc.
├── package.json             # Possibly a root package if using workspaces, or just to manage dev dependencies
└── ...
```

**Details:**

* **Core module** (`packages/core`): Exports functions like `discoverDependencies(projectPath, options): DiscoveryResult` and `convertToSnapshot(discoveryResult, options): Snapshot`. It will contain utility functions for file system scanning and parsing. We can publish this if needed, or keep internal.
* **CLI** (`packages/cli`): A thin wrapper using a CLI library (like Oclif, yargs, or Commander) that calls `core` functions. The CLI package will be configured with a bin entry in its `package.json` (e.g., `"bin": {"mcpapm-scan": "dist/index.js"}`) for global installation via NPM or usage via `npx`.
* **VS Code Extension** (`packages/vscode-extension`): Contains extension activation code (`extension.ts`), package manifest (`package.json` for extension with contributions), linking to the core library. Likely includes a compiled version of the core or references it if using a monorepo build pipeline (like using `npm link` or bundling core code into the extension via webpack).
* **Build & Dev**: Use a build tool like **esbuild** or **tsc** for each package. Possibly leverage Yarn or PNPM Workspaces for dependency management. CI pipeline can run tests on core and run the extension’s `vsce` packaging for distribution.

**Testing Strategy:**

* Write unit tests for core scanning logic using synthetic directory fixtures (simulate presence of various config files).
* Possibly use integration tests for the CLI commands (e.g., with a test repository or using snapshots of expected JSON).
* VS Code extension tests (if needed) can leverage VS Code’s extension test runner or simply rely on core tests plus minimal activation tests.

***

## 4. Non-Goals and Constraints

To keep the initial scope manageable, this design intentionally limits certain aspects:

* **Not a Dependabot Replacement**: The tool will not automatically create PRs to update dependencies. It’s focused on **discovery & reporting**.
* **No Live Dependency Resolution in v1**: The CLI will parse manifests statically. We won’t, initially, clone referenced repos or call external APIs to resolve versions of APM dependencies (to avoid complexity and reliance on network).
  * *However, the design leaves room for adding an “online mode” in future where the CLI could fetch additional info (like retrieving a referenced repository’s apm.yml to include its MCP dependencies, or resolving the latest version number of a git reference).*
* **Performance**: For now, assume relatively small projects. We might not optimize heavily for extremely large repos (though file globbing should be fast in Node). We must avoid scanning unnecessary directories (maybe put limits on node\_modules unless needed).
* **Security Considerations**: The tool reads configuration files and optionally global settings; it should not execute any commands (like not actually running `npx` for MCP servers) – it only inspects configuration text. This is to ensure running the tool has no side effects or security risks.

***

## 5. Cross-Platform Considerations & Future Extensibility

**OS-Specific Path Handling**: The discovery logic should account for different operating systems:

* Implement a function `getGlobalMcpConfigPaths()` that returns an array of possible user-level MCP config file paths:
  * Windows: Typically, `%APPDATA%\Code\User\mcp.json` (if VS Code stores it there) or parse `%APPDATA%\Code\User\settings.json` for an `"mcp.servers"` entry.
  * macOS: `~/Library/Application Support/Code/User/mcp.json` or user settings.
  * Linux: `~/.config/Code/User/mcp.json` or user settings.
  * (Paths may differ for Insiders or OSS builds of VS Code; possibly handle or document as needed.)
* **Path Normalization**: Use Node’s `path` module to handle Windows backslashes vs POSIX slashes, and environment variables for home directories.

**Extensibility**:

* **New Manifest Types**: The tool’s core scanning design can be extended to support future config formats:
  * *Example:* If Microsoft introduces new config file types for different editors or new agent standards, the `discoverDependencies` function can be extended with additional file patterns and parsers (without impacting the CLI or extension interface).
* **APM Enhancements**: As APM evolves (e.g., supporting additional dependency types or a registry), the tool can incorporate those:
  * Monitoring [APM’s GitHub repository](https://github.com/microsoft/apm) for issues or features (like \[global mcp.json support]\[issue-793] or others) will inform future improvements.
  * If **GitHub’s Dependency Graph** begins to support APM or MCP natively, our conversion logic might adjust to take advantage of new ecosystem identifiers.
* **SBOM Generation**: In future, add an option to output an **SBOM** (SPDX or CycloneDX) for compliance or alternative uses, since much of the data is similar.

***

## Summary

This design spec proposes a **Node.js CLI** and a **VS Code extension** to discover **MCP server configurations** and **APM manifests**, producing structured data that can be fed into GitHub’s Dependency Graph. By focusing on robust discovery across all major OS platforms and providing a conversion to GitHub’s snapshot format, the tool will fill a gap in tracking AI tool dependencies. The architecture emphasizes **code reusability** (via a shared core) and sets a foundation for future enhancements like deeper dependency resolution or integration with other scanning tools.
