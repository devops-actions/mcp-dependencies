import { spawnSync } from "node:child_process";
import * as path from "node:path";
import type { McpServer, McpSenseReport, ScanDiagnostic } from "./types.js";

/**
 * Returns true if the given file path is a candidate for MCPSense config-mode scanning.
 *
 * MCPSense config mode supports JSON files that have a top-level `mcpServers` key.
 * We exclude:
 *   - settings.json (VS Code settings; MCPSense does not consume this format)
 *   - non-JSON files (apm.yml, apm.lock.yaml, etc.)
 */
function isMcpSenseScannable(filePath: string): boolean {
  const filename = path.basename(filePath);
  return filename.endsWith(".json") && filename !== "settings.json";
}

/**
 * Checks if the mcpsense binary is available on PATH.
 * Returns the raw version output (e.g. "mcpsense v0.3.0") or null if not found.
 */
export function getMcpSenseVersion(): string | null {
  const result = spawnSync("mcpsense", ["version"], { encoding: "utf-8" });
  if (result.error || result.status !== 0) return null;
  return result.stdout?.trim() ?? null;
}

/**
 * Runs `mcpsense scan <filePath> --mode config --format json --severity low --no-baseline`
 * and returns the parsed report.
 *
 * Returns null if:
 *   - mcpsense is not installed (silent — ENOENT)
 *   - the file type is not supported by MCPSense (e.g. settings.json)
 *
 * Pushes a diagnostic warning if the scan fails for any other reason.
 *
 * Exit code behaviour (from MCPSense source):
 *   0 = success, no critical/high findings
 *   1 = success, critical/high findings present
 *   other = error
 */
export function runMcpSenseScan(
  filePath: string,
  diagnostics: ScanDiagnostic[]
): McpSenseReport | null {
  if (!isMcpSenseScannable(filePath)) {
    return null;
  }

  const result = spawnSync(
    "mcpsense",
    [
      "scan",
      filePath,
      "--mode",
      "config",
      "--format",
      "json",
      "--severity",
      "low",
      "--no-baseline",
    ],
    { encoding: "utf-8", timeout: 30_000 }
  );

  // Binary not installed — optional tool, skip silently
  if (result.error && (result.error as NodeJS.ErrnoException).code === "ENOENT") {
    return null;
  }

  // Spawn-level error (e.g. permissions, timeout)
  if (result.error) {
    diagnostics.push({
      level: "warning",
      file: filePath,
      kind: "mcpsense-error",
      message: `mcpsense could not be launched: ${result.error.message}`,
    });
    return null;
  }

  // Killed by signal or timed out (status === null)
  if (result.status === null) {
    diagnostics.push({
      level: "warning",
      file: filePath,
      kind: "mcpsense-error",
      message: `mcpsense was killed by signal ${result.signal ?? "unknown"} (possible timeout)`,
    });
    return null;
  }

  // exit 0 = clean, exit 1 = findings present — both are valid JSON output
  // Anything else is an unexpected error
  if (result.status !== 0 && result.status !== 1) {
    const stderr = result.stderr?.trim();
    diagnostics.push({
      level: "warning",
      file: filePath,
      kind: "mcpsense-scan-failed",
      message: `mcpsense exited with code ${result.status}${stderr ? `: ${stderr}` : ""}`,
    });
    return null;
  }

  const stdout = result.stdout?.trim();
  if (!stdout) {
    return null;
  }

  try {
    return JSON.parse(stdout) as McpSenseReport;
  } catch {
    diagnostics.push({
      level: "warning",
      file: filePath,
      kind: "mcpsense-parse-error",
      message: "Failed to parse mcpsense JSON output",
    });
    return null;
  }
}

/**
 * Runs MCPSense security scans on the unique config file locations backing
 * the discovered MCP servers. Files not supported by MCPSense (e.g. settings.json,
 * apm.yml) are silently skipped.
 *
 * If mcpsense is not installed, returns an empty map without any diagnostics.
 *
 * @param mcpServers  - Discovered MCP servers (from discoverDependencies)
 * @param diagnostics - Diagnostic accumulator (mutated in place)
 * @returns Map from absolute file path to the MCPSense scan report for that file
 */
export function scanMcpServersWithMcpSense(
  mcpServers: McpServer[],
  diagnostics: ScanDiagnostic[]
): Map<string, McpSenseReport> {
  const results = new Map<string, McpSenseReport>();

  // Deduplicate and sort for deterministic output
  const uniqueLocations = [
    ...new Set(mcpServers.map((s) => s.location)),
  ].sort();

  for (const location of uniqueLocations) {
    if (!isMcpSenseScannable(location)) continue;
    const report = runMcpSenseScan(location, diagnostics);
    if (report !== null) {
      results.set(location, report);
    }
  }

  return results;
}
