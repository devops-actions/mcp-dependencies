import { randomUUID } from "crypto";
import type {
  DiscoveryResult,
  ConvertOptions,
  DependencySnapshot,
  SnapshotDependency,
} from "./types.js";

/** Version of this tool reported in snapshots */
const TOOL_VERSION = "0.1.0";

/**
 * Encodes a package URL component (percent-encoding '@' etc.)
 */
function encodePurlComponent(s: string): string {
  return encodeURIComponent(s).replace(/%40/g, "%40");
}

/**
 * Builds a purl for an npm package.
 * e.g. pkg:npm/%40scope/name@1.0.0
 */
function npmPurl(packageName: string, version: string | null | undefined): string {
  const encoded = encodePurlComponent(packageName);
  return version ? `pkg:npm/${encoded}@${version}` : `pkg:npm/${encoded}`;
}

/**
 * Builds a purl for a GitHub-hosted dependency (skills, plugins, apm packages).
 * e.g. pkg:github/owner/repo@v1.0.0
 */
function githubPurl(id: string, version: string | null | undefined): string {
  // Normalize the id to remove leading slashes
  const normalized = id.replace(/^\//, "");
  return version
    ? `pkg:github/${normalized}@${version}`
    : `pkg:github/${normalized}`;
}

/**
 * Converts a DiscoveryResult into a GitHub Dependency Submission API snapshot.
 *
 * @param result - The DiscoveryResult from discoverDependencies()
 * @param options - Conversion options (sha, ref, correlator)
 * @returns A DependencySnapshot ready for submission
 */
export function convertToSnapshot(
  result: DiscoveryResult,
  options: ConvertOptions = {}
): DependencySnapshot {
  const {
    sha = process.env.GITHUB_SHA ?? "",
    ref = process.env.GITHUB_REF ?? "refs/heads/main",
    correlator = process.env.GITHUB_WORKFLOW ?? "mcp-apm-scan",
  } = options;

  const jobId = randomUUID();
  const dependencies: SnapshotDependency[] = [];

  // --- MCP Servers ---
  for (const server of result.mcpServers) {
    let packageUrl: string;

    if (server.ecosystem === "npm" && server.packageName) {
      packageUrl = npmPurl(server.packageName, server.version);
    } else if (server.url) {
      // HTTP/remote servers: use generic purl with the server name
      const safeName = encodeURIComponent(server.name);
      packageUrl = `pkg:generic/${safeName}`;
    } else {
      // fallback
      packageUrl = `pkg:generic/${encodeURIComponent(server.name)}`;
    }

    dependencies.push({
      package_url: packageUrl,
      relationship: "direct",
    });
  }

  // --- Other APM Dependencies ---
  for (const dep of result.otherDependencies) {
    const packageUrl = githubPurl(dep.id, dep.version);
    dependencies.push({
      package_url: packageUrl,
      relationship: "direct",
    });
  }

  // Deduplicate by package_url to avoid duplicate snapshot entries
  const seen = new Set<string>();
  const uniqueDeps = dependencies.filter((d) => {
    if (seen.has(d.package_url)) return false;
    seen.add(d.package_url);
    return true;
  });

  const snapshot: DependencySnapshot = {
    version: 0,
    job: {
      id: jobId,
      correlator,
    },
    sha,
    ref,
    detector: {
      name: "mcp-apm-scan",
      version: TOOL_VERSION,
      url: "https://github.com/devops-actions/mcp-dependencies",
    },
    manifests: {
      "agent-dependencies": {
        name: "Agent Configuration Dependencies",
        file: "apm.yml",
        resolved: false,
        dependencies: uniqueDeps,
      },
    },
  };

  return snapshot;
}
