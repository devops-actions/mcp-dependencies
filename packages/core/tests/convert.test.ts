import { describe, it, expect } from "vitest";
import { convertToSnapshot } from "../src/convert.js";
import type { DiscoveryResult } from "../src/types.js";

const sampleResult: DiscoveryResult = {
  mcpServers: [
    {
      name: "playwright",
      source: "workspace",
      location: ".vscode/mcp.json",
      type: "stdio",
      command: "npx",
      args: ["-y", "@microsoft/mcp-server-playwright"],
      ecosystem: "npm",
      packageName: "@microsoft/mcp-server-playwright",
      version: null,
    },
    {
      name: "github",
      source: "workspace",
      location: ".vscode/mcp.json",
      type: "http",
      url: "https://api.githubcopilot.com/mcp",
      ecosystem: null,
      packageName: null,
      version: null,
    },
  ],
  otherDependencies: [
    {
      id: "anthropics/skills/skills/frontend-design",
      type: "apm-skill",
      version: null,
      source: "apm.yml",
    },
    {
      id: "microsoft/apm-sample-package",
      type: "apm-package",
      version: "v1.0.0",
      source: "apm.yml",
    },
  ],
  diagnostics: [],
};

describe("convertToSnapshot", () => {
  it("produces a valid snapshot structure", () => {
    const snapshot = convertToSnapshot(sampleResult, {
      sha: "abc123",
      ref: "refs/heads/main",
      correlator: "test",
    });

    expect(snapshot.version).toBe(0);
    expect(snapshot.sha).toBe("abc123");
    expect(snapshot.ref).toBe("refs/heads/main");
    expect(snapshot.detector.name).toBe("mcp-apm-scan");
    expect(snapshot.manifests).toHaveProperty("agent-dependencies");
  });

  it("maps npm packages to pkg:npm purls", () => {
    const snapshot = convertToSnapshot(sampleResult, { sha: "x", ref: "r" });
    const deps = snapshot.manifests["agent-dependencies"].dependencies;
    const npmPurl = deps.find((d) => d.package_url.startsWith("pkg:npm/"))!;
    expect(npmPurl).toBeDefined();
    expect(npmPurl.package_url).toContain("mcp-server-playwright");
    expect(npmPurl.relationship).toBe("direct");
  });

  it("maps github dependencies to pkg:github purls", () => {
    const snapshot = convertToSnapshot(sampleResult, { sha: "x", ref: "r" });
    const deps = snapshot.manifests["agent-dependencies"].dependencies;
    const githubPurl = deps.find((d) => d.package_url.startsWith("pkg:github/"))!;
    expect(githubPurl).toBeDefined();
  });

  it("includes versioned packages with version in purl", () => {
    const snapshot = convertToSnapshot(sampleResult, { sha: "x", ref: "r" });
    const deps = snapshot.manifests["agent-dependencies"].dependencies;
    const versioned = deps.find((d) => d.package_url.includes("apm-sample-package"))!;
    expect(versioned).toBeDefined();
    expect(versioned.package_url).toContain("@v1.0.0");
  });

  it("deduplicates dependencies by package_url", () => {
    const duplicated: DiscoveryResult = {
      ...sampleResult,
      mcpServers: [...sampleResult.mcpServers, ...sampleResult.mcpServers],
    };
    const snapshot = convertToSnapshot(duplicated, { sha: "x", ref: "r" });
    const deps = snapshot.manifests["agent-dependencies"].dependencies;
    const urls = deps.map((d) => d.package_url);
    expect(new Set(urls).size).toBe(urls.length);
  });
});
