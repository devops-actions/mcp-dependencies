import * as fs from "fs";
import { parse as parseJsonc } from "jsonc-parser";
import type { McpServer, ScanDiagnostic } from "../types.js";

/**
 * Shape of a server entry inside mcp.json or settings.json["mcp"]["servers"].
 */
interface RawMcpServerEntry {
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  env?: Record<string, string>;
  [key: string]: unknown;
}

/**
 * Infers npm package name and version from a stdio MCP server command/args.
 * e.g. `npx -y @microsoft/mcp-server-playwright@1.2.3` → packageName, version
 */
function inferNpmPackage(
  command: string | undefined,
  args: string[] | undefined
): { ecosystem: string | null; packageName: string | null; version: string | null } {
  if (!command || !["npx", "node"].includes(command)) {
    return { ecosystem: null, packageName: null, version: null };
  }

  const effectiveArgs = args ?? [];
  // Find the first non-flag argument in args (skip -y, --yes, etc.)
  const packageArg = effectiveArgs.find(
    (a) => !a.startsWith("-") && a !== "npx" && a !== "node"
  );
  if (!packageArg) return { ecosystem: null, packageName: null, version: null };

  // Separate version if included in format: @scope/pkg@version or pkg@version
  const atIndex = packageArg.lastIndexOf("@");
  if (atIndex > 0) {
    return {
      ecosystem: "npm",
      packageName: packageArg.slice(0, atIndex),
      version: packageArg.slice(atIndex + 1) || null,
    };
  }

  return { ecosystem: "npm", packageName: packageArg, version: null };
}

/**
 * Parses the raw server map from a mcp.json or settings.json mcp block.
 */
function parseServerMap(
  servers: Record<string, RawMcpServerEntry>,
  source: "workspace" | "user",
  location: string,
  diagnostics: ScanDiagnostic[]
): McpServer[] {
  const result: McpServer[] = [];

  for (const [name, entry] of Object.entries(servers)) {
    if (typeof entry !== "object" || entry === null) {
      diagnostics.push({
        level: "warning",
        file: location,
        kind: "invalid-server-entry",
        message: `Server entry "${name}" is not an object; skipping.`,
      });
      continue;
    }

    const type = (entry.type as string) ?? (entry.url ? "http" : "stdio");
    const { ecosystem, packageName, version } = inferNpmPackage(
      entry.command,
      entry.args
    );

    const server: McpServer = {
      name,
      source,
      location,
      type,
      ...(entry.command !== undefined && { command: entry.command }),
      ...(entry.args !== undefined && { args: entry.args }),
      ...(entry.url !== undefined && { url: entry.url as string }),
      ecosystem,
      packageName,
      version,
    };

    result.push(server);
  }

  return result;
}

/**
 * Parses a standalone mcp.json file.
 * Format: { "servers": { "name": { ... }, ... } }
 */
export function parseMcpJson(
  filePath: string,
  source: "workspace" | "user",
  diagnostics: ScanDiagnostic[]
): McpServer[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch (err) {
    diagnostics.push({
      level: "error",
      file: filePath,
      kind: "file-read-error",
      message: `Could not read file: ${(err as Error).message}`,
    });
    return [];
  }

  const errors: import("jsonc-parser").ParseError[] = [];
  const parsed = parseJsonc(raw, errors) as {
    servers?: Record<string, RawMcpServerEntry>;
    mcpServers?: Record<string, RawMcpServerEntry>;
  };

  if (errors.length > 0) {
    diagnostics.push({
      level: "warning",
      file: filePath,
      kind: "json-parse-warning",
      message: `JSONC parse issues (${errors.length} error(s)); some entries may be missing.`,
    });
  }

  const servers = parsed?.servers ?? parsed?.mcpServers;
  if (!servers || typeof servers !== "object") {
    diagnostics.push({
      level: "warning",
      file: filePath,
      kind: "no-servers",
      message: 'No "servers" or "mcpServers" key found; nothing to import.',
    });
    return [];
  }

  return parseServerMap(servers, source, filePath, diagnostics);
}

/**
 * Parses a VS Code settings.json (JSONC), extracting mcp.servers if present.
 * Supports both "mcp.servers" flat key and nested { "mcp": { "servers": {} } }.
 */
export function parseSettingsJsonForMcp(
  filePath: string,
  diagnostics: ScanDiagnostic[]
): McpServer[] {
  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    // settings.json not present is normal; not an error
    return [];
  }

  const errors: import("jsonc-parser").ParseError[] = [];
  const parsed = parseJsonc(raw, errors) as Record<string, unknown>;

  if (errors.length > 0) {
    diagnostics.push({
      level: "warning",
      file: filePath,
      kind: "jsonc-parse-warning",
      message: `JSONC parse issues in settings.json (${errors.length} error(s)); mcp entries may be incomplete.`,
    });
  }

  if (!parsed || typeof parsed !== "object") return [];

  // Try nested format: { "mcp": { "servers": { ... } } }
  const mcpBlock = parsed["mcp"] as { servers?: Record<string, RawMcpServerEntry> } | undefined;
  const nestedServers = mcpBlock?.servers;

  // Try flat format: { "mcp.servers": { ... } }
  const flatServers = parsed["mcp.servers"] as Record<string, RawMcpServerEntry> | undefined;

  const servers = nestedServers ?? flatServers;
  if (!servers) return [];

  return parseServerMap(servers, "user", filePath, diagnostics);
}
