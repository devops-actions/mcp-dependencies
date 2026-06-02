import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { parseMcpJson, parseSettingsJsonForMcp } from "../src/parsers/mcpJson.js";
import type { ScanDiagnostic } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

describe("parseMcpJson", () => {
  it("parses workspace-mcp.json and extracts all servers", () => {
    const diagnostics: ScanDiagnostic[] = [];
    const servers = parseMcpJson(
      path.join(FIXTURES, "workspace-mcp.json"),
      "workspace",
      diagnostics
    );

    expect(diagnostics.filter((d) => d.level === "error")).toHaveLength(0);
    expect(servers).toHaveLength(3);

    const playwright = servers.find((s) => s.name === "playwright")!;
    expect(playwright).toBeDefined();
    expect(playwright.type).toBe("stdio");
    expect(playwright.command).toBe("npx");
    expect(playwright.args).toContain("@microsoft/mcp-server-playwright");
    expect(playwright.ecosystem).toBe("npm");
    expect(playwright.packageName).toBe("@microsoft/mcp-server-playwright");
    expect(playwright.version).toBeNull();
    expect(playwright.source).toBe("workspace");

    const github = servers.find((s) => s.name === "github")!;
    expect(github).toBeDefined();
    expect(github.type).toBe("http");
    expect(github.url).toBe("https://api.githubcopilot.com/mcp");

    const pinned = servers.find((s) => s.name === "pinned-tool")!;
    expect(pinned).toBeDefined();
    expect(pinned.version).toBe("2.0.0");
    expect(pinned.packageName).toBe("some-mcp-tool");
  });

  it("returns empty array and error diagnostic for missing file", () => {
    const diagnostics: ScanDiagnostic[] = [];
    const servers = parseMcpJson("/nonexistent/path/mcp.json", "workspace", diagnostics);
    expect(servers).toHaveLength(0);
    expect(diagnostics).toHaveLength(1);
    expect(diagnostics[0].level).toBe("error");
    expect(diagnostics[0].kind).toBe("file-read-error");
  });
});

describe("parseSettingsJsonForMcp", () => {
  it("extracts mcp.servers from JSONC settings.json", () => {
    const diagnostics: ScanDiagnostic[] = [];
    const servers = parseSettingsJsonForMcp(
      path.join(FIXTURES, "settings.jsonc"),
      diagnostics
    );

    expect(diagnostics.filter((d) => d.level === "error")).toHaveLength(0);
    expect(servers).toHaveLength(1);
    expect(servers[0].name).toBe("global-playwright");
    expect(servers[0].source).toBe("user");
    expect(servers[0].ecosystem).toBe("npm");
  });

  it("returns empty array silently for non-existent settings.json", () => {
    const diagnostics: ScanDiagnostic[] = [];
    const servers = parseSettingsJsonForMcp("/nonexistent/settings.json", diagnostics);
    expect(servers).toHaveLength(0);
    expect(diagnostics).toHaveLength(0);
  });
});
