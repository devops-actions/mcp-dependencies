import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SpawnSyncReturns } from "child_process";

// Mock node:child_process before importing the module under test
vi.mock("node:child_process", () => ({
  spawnSync: vi.fn(),
}));

import { spawnSync } from "node:child_process";
import {
  getMcpSenseVersion,
  runMcpSenseScan,
  scanMcpServersWithMcpSense,
} from "../src/mcpsense.js";
import type { McpServer, ScanDiagnostic } from "../src/types.js";
import * as path from "node:path";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_REPORT = JSON.parse(
  readFileSync(path.join(__dirname, "fixtures", "mcpsense-report.json"), "utf-8")
);

const mockSpawnSync = vi.mocked(spawnSync);

/** Helper: build a minimal SpawnSyncReturns */
function makeSpawnResult(
  overrides: Partial<SpawnSyncReturns<string>> = {}
): SpawnSyncReturns<string> {
  return {
    pid: 1234,
    output: [],
    stdout: "",
    stderr: "",
    status: 0,
    signal: null,
    error: undefined,
    ...overrides,
  };
}

/** Helper: make an ENOENT error */
function makeEnoent(): NodeJS.ErrnoException {
  const err = new Error("spawn mcpsense ENOENT") as NodeJS.ErrnoException;
  err.code = "ENOENT";
  return err;
}

/** Minimal McpServer fixture */
function makeMcpServer(location: string, extra: Partial<McpServer> = {}): McpServer {
  return {
    name: "test-server",
    source: "workspace",
    location,
    type: "stdio",
    command: "npx",
    args: ["-y", "@modelcontextprotocol/server-everything"],
    ecosystem: "npm",
    packageName: "@modelcontextprotocol/server-everything",
    version: null,
    ...extra,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// getMcpSenseVersion
// ─────────────────────────────────────────────────────────────────────────────
describe("getMcpSenseVersion", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  it("returns the version string when mcpsense is available", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ stdout: "mcpsense v0.3.0\n", status: 0 })
    );
    expect(getMcpSenseVersion()).toBe("mcpsense v0.3.0");
  });

  it("returns null when mcpsense is not installed (ENOENT)", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ error: makeEnoent(), status: null })
    );
    expect(getMcpSenseVersion()).toBeNull();
  });

  it("returns null when mcpsense exits non-zero", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ status: 2, stdout: "" })
    );
    expect(getMcpSenseVersion()).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// runMcpSenseScan
// ─────────────────────────────────────────────────────────────────────────────
describe("runMcpSenseScan", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  it("returns null silently when mcpsense is not installed (ENOENT)", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ error: makeEnoent(), status: null })
    );
    const diags: ScanDiagnostic[] = [];
    const result = runMcpSenseScan("/path/to/mcp.json", diags);
    expect(result).toBeNull();
    expect(diags).toHaveLength(0);
  });

  it("returns null with diagnostic on non-ENOENT spawn error", () => {
    const err = new Error("permission denied");
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ error: err, status: null })
    );
    const diags: ScanDiagnostic[] = [];
    const result = runMcpSenseScan("/path/to/mcp.json", diags);
    expect(result).toBeNull();
    expect(diags).toHaveLength(1);
    expect(diags[0].kind).toBe("mcpsense-error");
    expect(diags[0].message).toContain("permission denied");
  });

  it("returns null with diagnostic when killed by signal / status is null", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ status: null, signal: "SIGKILL" })
    );
    const diags: ScanDiagnostic[] = [];
    const result = runMcpSenseScan("/path/to/mcp.json", diags);
    expect(result).toBeNull();
    expect(diags).toHaveLength(1);
    expect(diags[0].kind).toBe("mcpsense-error");
    expect(diags[0].message).toContain("SIGKILL");
  });

  it("returns parsed report on exit code 0 (no critical/high findings)", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ status: 0, stdout: JSON.stringify(FIXTURE_REPORT) })
    );
    const diags: ScanDiagnostic[] = [];
    const result = runMcpSenseScan("/home/user/.cursor/mcp.json", diags);
    expect(result).not.toBeNull();
    expect(result!.score).toBe(75);
    expect(result!.findings).toHaveLength(2);
    expect(diags).toHaveLength(0);
  });

  it("returns parsed report on exit code 1 (critical/high findings present)", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ status: 1, stdout: JSON.stringify(FIXTURE_REPORT) })
    );
    const diags: ScanDiagnostic[] = [];
    const result = runMcpSenseScan("/home/user/.cursor/mcp.json", diags);
    expect(result).not.toBeNull();
    expect(result!.findings[0].severity).toBe("critical");
    expect(diags).toHaveLength(0);
  });

  it("returns null with diagnostic on unexpected non-0/1 exit code", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ status: 2, stderr: "internal error" })
    );
    const diags: ScanDiagnostic[] = [];
    const result = runMcpSenseScan("/path/to/mcp.json", diags);
    expect(result).toBeNull();
    expect(diags).toHaveLength(1);
    expect(diags[0].kind).toBe("mcpsense-scan-failed");
    expect(diags[0].message).toContain("code 2");
    expect(diags[0].message).toContain("internal error");
  });

  it("returns null with diagnostic when JSON output is malformed", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ status: 0, stdout: "not valid json {{{" })
    );
    const diags: ScanDiagnostic[] = [];
    const result = runMcpSenseScan("/path/to/mcp.json", diags);
    expect(result).toBeNull();
    expect(diags).toHaveLength(1);
    expect(diags[0].kind).toBe("mcpsense-parse-error");
  });

  it("returns null without calling spawn for settings.json (unsupported)", () => {
    const diags: ScanDiagnostic[] = [];
    const result = runMcpSenseScan("/path/to/.vscode/settings.json", diags);
    expect(result).toBeNull();
    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(diags).toHaveLength(0);
  });

  it("returns null without calling spawn for apm.yml (unsupported)", () => {
    const diags: ScanDiagnostic[] = [];
    const result = runMcpSenseScan("/path/to/apm.yml", diags);
    expect(result).toBeNull();
    expect(mockSpawnSync).not.toHaveBeenCalled();
    expect(diags).toHaveLength(0);
  });

  it("invokes mcpsense with --mode config and explicit flags", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ status: 0, stdout: JSON.stringify(FIXTURE_REPORT) })
    );
    runMcpSenseScan("/path/to/mcp.json", []);
    const [cmd, args] = mockSpawnSync.mock.calls[0];
    expect(cmd).toBe("mcpsense");
    expect(args).toContain("--mode");
    expect(args).toContain("config");
    expect(args).toContain("--format");
    expect(args).toContain("json");
    expect(args).toContain("--severity");
    expect(args).toContain("low");
    expect(args).toContain("--no-baseline");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// scanMcpServersWithMcpSense
// ─────────────────────────────────────────────────────────────────────────────
describe("scanMcpServersWithMcpSense", () => {
  beforeEach(() => {
    mockSpawnSync.mockReset();
  });

  it("returns empty map silently when mcpsense is not installed", () => {
    mockSpawnSync.mockReturnValue(
      makeSpawnResult({ error: makeEnoent(), status: null })
    );
    const servers = [makeMcpServer("/path/to/mcp.json")];
    const diags: ScanDiagnostic[] = [];
    const result = scanMcpServersWithMcpSense(servers, diags);
    expect(result.size).toBe(0);
    expect(diags).toHaveLength(0);
  });

  it("scans each unique location once", () => {
    mockSpawnSync.mockReturnValue(
      makeSpawnResult({ status: 0, stdout: JSON.stringify(FIXTURE_REPORT) })
    );
    const servers = [
      makeMcpServer("/path/to/mcp.json", { name: "server-a" }),
      makeMcpServer("/path/to/mcp.json", { name: "server-b" }), // same file
      makeMcpServer("/other/mcp.json", { name: "server-c" }),
    ];
    const diags: ScanDiagnostic[] = [];
    scanMcpServersWithMcpSense(servers, diags);
    // Two unique locations → spawnSync called twice
    expect(mockSpawnSync).toHaveBeenCalledTimes(2);
  });

  it("skips settings.json entries", () => {
    const servers = [
      makeMcpServer("/path/to/.vscode/settings.json"),
      makeMcpServer("/path/to/mcp.json"),
    ];
    mockSpawnSync.mockReturnValue(
      makeSpawnResult({ status: 0, stdout: JSON.stringify(FIXTURE_REPORT) })
    );
    const diags: ScanDiagnostic[] = [];
    const result = scanMcpServersWithMcpSense(servers, diags);
    // Only mcp.json is scanned
    expect(mockSpawnSync).toHaveBeenCalledTimes(1);
    expect(result.has("/path/to/mcp.json")).toBe(true);
    expect(result.has("/path/to/.vscode/settings.json")).toBe(false);
  });

  it("skips apm.yml entries", () => {
    const servers = [makeMcpServer("/path/to/apm.yml", { source: "apm" as const })];
    const diags: ScanDiagnostic[] = [];
    scanMcpServersWithMcpSense(servers, diags);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });

  it("returns a map keyed by absolute file path", () => {
    mockSpawnSync.mockReturnValueOnce(
      makeSpawnResult({ status: 0, stdout: JSON.stringify(FIXTURE_REPORT) })
    );
    const servers = [makeMcpServer("/project/.vscode/mcp.json")];
    const result = scanMcpServersWithMcpSense(servers, []);
    expect(result.has("/project/.vscode/mcp.json")).toBe(true);
    expect(result.get("/project/.vscode/mcp.json")!.score).toBe(75);
  });

  it("returns empty map when no servers provided", () => {
    const result = scanMcpServersWithMcpSense([], []);
    expect(result.size).toBe(0);
    expect(mockSpawnSync).not.toHaveBeenCalled();
  });
});
