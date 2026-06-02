import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { parseApmYml } from "../src/parsers/apmYml.js";
import type { ScanDiagnostic } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

describe("parseApmYml", () => {
  it("parses mcp servers and other dependencies from apm.yml", () => {
    const diagnostics: ScanDiagnostic[] = [];
    const { mcpServers, otherDependencies } = parseApmYml(
      path.join(FIXTURES, "apm.yml"),
      diagnostics
    );

    expect(diagnostics.filter((d) => d.level === "error")).toHaveLength(0);

    // MCP servers
    expect(mcpServers).toHaveLength(2);
    const githubServer = mcpServers.find((s) => s.name === "io.github.github/github-mcp-server")!;
    expect(githubServer).toBeDefined();
    expect(githubServer.type).toBe("http");
    expect(githubServer.url).toBe("https://api.githubcopilot.com/mcp");
    expect(githubServer.source).toBe("apm");

    const stdioServer = mcpServers.find((s) => s.name === "my-stdio-server")!;
    expect(stdioServer).toBeDefined();
    expect(stdioServer.type).toBe("stdio");
    expect(stdioServer.command).toBe("node");

    // Other dependencies
    expect(otherDependencies).toHaveLength(4);

    const skill = otherDependencies.find((d) => d.id.includes("frontend-design"))!;
    expect(skill).toBeDefined();
    expect(skill.type).toBe("apm-skill");
    expect(skill.version).toBeNull();

    const plugin = otherDependencies.find((d) => d.id.includes("context-engineering"))!;
    expect(plugin).toBeDefined();
    expect(plugin.type).toBe("apm-plugin");

    const pkg = otherDependencies.find((d) => d.id === "microsoft/apm-sample-package")!;
    expect(pkg).toBeDefined();
    expect(pkg.type).toBe("apm-package");
    expect(pkg.version).toBe("v1.0.0");

    const simplePkg = otherDependencies.find((d) => d.id === "owner/simple-package")!;
    expect(simplePkg).toBeDefined();
    expect(simplePkg.type).toBe("apm-package");
    expect(simplePkg.version).toBeNull();
  });

  it("returns error diagnostic and empty results for missing file", () => {
    const diagnostics: ScanDiagnostic[] = [];
    const { mcpServers, otherDependencies } = parseApmYml("/nonexistent/apm.yml", diagnostics);
    expect(mcpServers).toHaveLength(0);
    expect(otherDependencies).toHaveLength(0);
    expect(diagnostics[0].level).toBe("error");
  });
});
