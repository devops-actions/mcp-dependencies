import * as fs from "fs";
import * as path from "path";
import fg from "fast-glob";
import type { DiscoveryResult, DiscoverOptions, McpServer, OtherDependency, ScanDiagnostic } from "./types.js";
import { parseMcpJson, parseSettingsJsonForMcp } from "./parsers/mcpJson.js";
import { parseApmYml } from "./parsers/apmYml.js";
import { parseApmLock } from "./parsers/apmLock.js";
import { getGlobalMcpJsonPaths, getGlobalSettingsJsonPaths } from "./globalPaths.js";

/** Default glob patterns to ignore when scanning */
const DEFAULT_IGNORES = [
  "**/node_modules/**",
  "**/.git/**",
  "**/dist/**",
  "**/out/**",
  "**/build/**",
  "**/.venv/**",
  "**/vendor/**",
];

/**
 * Deduplicates MCP servers by name+source, keeping the first occurrence.
 * Sorts by name for deterministic output.
 */
function deduplicateMcpServers(servers: McpServer[]): McpServer[] {
  const seen = new Set<string>();
  const deduped = servers.filter((s) => {
    const key = `${s.name}::${s.source}::${s.location}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Deduplicates other dependencies by id+source.
 * Sorts by id for deterministic output.
 */
function deduplicateOtherDeps(deps: OtherDependency[]): OtherDependency[] {
  const seen = new Set<string>();
  const deduped = deps.filter((d) => {
    const key = `${d.id}::${d.source}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return deduped.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Discovers MCP server configurations and APM dependencies in the given project path.
 *
 * @param projectPath - Root directory of the project to scan
 * @param options - Discovery options
 * @returns DiscoveryResult with mcpServers, otherDependencies, and diagnostics
 */
export async function discoverDependencies(
  projectPath: string,
  options: DiscoverOptions = {}
): Promise<DiscoveryResult> {
  const { includeGlobal = true, extraIgnores = [] } = options;
  const diagnostics: ScanDiagnostic[] = [];
  const allMcpServers: McpServer[] = [];
  const allOtherDeps: OtherDependency[] = [];
  const ignores = [...DEFAULT_IGNORES, ...extraIgnores];

  const absRoot = path.resolve(projectPath);

  // --- 1. Workspace-level mcp.json (.vscode/mcp.json) ---
  const workspaceMcpPaths = await fg(["**/.vscode/mcp.json", "**/mcp.json"], {
    cwd: absRoot,
    absolute: true,
    ignore: ignores,
    dot: true,
  });

  for (const mcpPath of workspaceMcpPaths.sort()) {
    const servers = parseMcpJson(mcpPath, "workspace", diagnostics);
    allMcpServers.push(...servers);
  }

  // --- 2. Workspace-level settings.json for mcp.servers ---
  const workspaceSettingsPaths = await fg(["**/.vscode/settings.json"], {
    cwd: absRoot,
    absolute: true,
    ignore: ignores,
    dot: true,
  });

  for (const settingsPath of workspaceSettingsPaths.sort()) {
    const servers = parseSettingsJsonForMcp(settingsPath, diagnostics);
    allMcpServers.push(...servers);
  }

  // --- 3. Global user VS Code config ---
  if (includeGlobal) {
    for (const mcpPath of getGlobalMcpJsonPaths()) {
      if (fs.existsSync(mcpPath)) {
        const servers = parseMcpJson(mcpPath, "user", diagnostics);
        allMcpServers.push(...servers);
      }
    }
    for (const settingsPath of getGlobalSettingsJsonPaths()) {
      if (fs.existsSync(settingsPath)) {
        const servers = parseSettingsJsonForMcp(settingsPath, diagnostics);
        allMcpServers.push(...servers);
      }
    }
  }

  // --- 4. APM manifests (apm.yml) ---
  const apmYmlPaths = await fg(["**/apm.yml", "**/apm.yaml"], {
    cwd: absRoot,
    absolute: true,
    ignore: ignores,
    dot: true,
  });

  for (const apmPath of apmYmlPaths.sort()) {
    const { mcpServers, otherDependencies } = parseApmYml(apmPath, diagnostics);
    allMcpServers.push(...mcpServers);
    allOtherDeps.push(...otherDependencies);
  }

  // --- 5. APM lockfiles for resolved versions ---
  const apmLockPaths = await fg(["**/apm.lock.yaml", "**/apm.lock.yml"], {
    cwd: absRoot,
    absolute: true,
    ignore: ignores,
    dot: true,
  });

  for (const lockPath of apmLockPaths.sort()) {
    const resolved = parseApmLock(lockPath, diagnostics);
    // Enrich otherDependencies with resolved versions from lockfile
    for (const dep of allOtherDeps) {
      const lock = resolved.get(dep.id);
      if (lock && dep.version === null) {
        dep.version = lock.version;
      }
    }
  }

  return {
    mcpServers: deduplicateMcpServers(allMcpServers),
    otherDependencies: deduplicateOtherDeps(allOtherDeps),
    diagnostics,
  };
}
