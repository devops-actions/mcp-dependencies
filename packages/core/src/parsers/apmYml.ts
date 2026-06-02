import * as fs from "fs";
import * as yaml from "js-yaml";
import type { McpServer, OtherDependency, ApmDependencyType, ScanDiagnostic } from "../types.js";

/**
 * Raw shape of an apm.yml file's dependencies section.
 */
interface ApmDependencies {
  mcp?: Record<string, RawApmMcpEntry>;
  apm?: Record<string, string | null> | string[];
}

interface RawApmMcpEntry {
  transport?: string;
  type?: string;
  command?: string;
  args?: string[];
  url?: string;
  [key: string]: unknown;
}

interface ApmYml {
  dependencies?: ApmDependencies;
  [key: string]: unknown;
}

/**
 * Infers the ApmDependencyType from a dependency reference string.
 * e.g. "owner/repo/skills/..." → apm-skill
 */
function inferApmType(ref: string): ApmDependencyType {
  const lower = ref.toLowerCase();
  if (lower.includes("/skills/") || lower.includes("/skill/")) return "apm-skill";
  if (lower.includes("/plugins/") || lower.includes("/plugin/")) return "apm-plugin";
  // owner/repo or owner/repo#version patterns suggest an apm-package
  const parts = ref.split("#")[0].split("/");
  if (parts.length === 2) return "apm-package";
  return "apm-unknown";
}

/**
 * Extracts version from a reference string like "owner/repo#v1.0.0".
 */
function extractVersion(ref: string): { id: string; version: string | null } {
  const hashIdx = ref.indexOf("#");
  if (hashIdx === -1) return { id: ref, version: null };
  return { id: ref.slice(0, hashIdx), version: ref.slice(hashIdx + 1) || null };
}

/**
 * Parses an apm.yml file and returns discovered MCP servers and other dependencies.
 */
export function parseApmYml(
  filePath: string,
  diagnostics: ScanDiagnostic[]
): { mcpServers: McpServer[]; otherDependencies: OtherDependency[] } {
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
    return { mcpServers: [], otherDependencies: [] };
  }

  let parsed: ApmYml;
  try {
    parsed = (yaml.load(raw) as ApmYml) ?? {};
  } catch (err) {
    diagnostics.push({
      level: "error",
      file: filePath,
      kind: "yaml-parse-error",
      message: `YAML parse error: ${(err as Error).message}`,
    });
    return { mcpServers: [], otherDependencies: [] };
  }

  const mcpServers: McpServer[] = [];
  const otherDependencies: OtherDependency[] = [];
  const deps = parsed?.dependencies;

  // --- MCP servers from dependencies.mcp ---
  if (deps?.mcp && typeof deps.mcp === "object") {
    for (const [name, entry] of Object.entries(deps.mcp)) {
      if (!entry || typeof entry !== "object") continue;
      const type = entry.transport ?? entry.type ?? (entry.url ? "http" : "stdio");
      mcpServers.push({
        name,
        source: "apm",
        location: filePath,
        type,
        ...(entry.command !== undefined && { command: entry.command }),
        ...(entry.args !== undefined && { args: entry.args }),
        ...(entry.url !== undefined && { url: entry.url as string }),
        ecosystem: null,
        packageName: null,
        version: null,
      });
    }
  }

  // --- Other APM dependencies from dependencies.apm ---
  if (deps?.apm) {
    const apmEntries: string[] = Array.isArray(deps.apm)
      ? deps.apm.filter((e): e is string => typeof e === "string")
      : Object.keys(deps.apm);

    for (const ref of apmEntries) {
      if (typeof ref !== "string") continue;
      const { id, version } = extractVersion(ref.trim());
      otherDependencies.push({
        id,
        type: inferApmType(id),
        version,
        source: filePath,
      });
    }
  }

  return { mcpServers, otherDependencies };
}
