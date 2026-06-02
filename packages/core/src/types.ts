/**
 * Core type definitions for MCP and APM dependency discovery.
 */

/** Source of a discovered dependency */
export type DependencySource = "workspace" | "user" | "apm";

/** Transport type for MCP servers */
export type McpTransportType = "stdio" | "http" | "sse" | string;

/** A discovered MCP server configuration */
export interface McpServer {
  /** Unique name/identifier as defined in config */
  name: string;
  /** Where this was found */
  source: DependencySource;
  /** File path where this was found */
  location: string;
  /** Connection type */
  type: McpTransportType;
  /** For stdio servers: launch command */
  command?: string;
  /** For stdio servers: launch arguments */
  args?: string[];
  /** For http/sse servers: endpoint URL */
  url?: string;
  /** Inferred package ecosystem (e.g. "npm") */
  ecosystem?: string | null;
  /** Inferred package name */
  packageName?: string | null;
  /** Inferred package version, if pinned */
  version?: string | null;
}

/** Category of an APM dependency */
export type ApmDependencyType =
  | "apm-package"
  | "apm-skill"
  | "apm-plugin"
  | "apm-unknown";

/** A discovered APM dependency (non-MCP) */
export interface OtherDependency {
  /** Reference string (e.g. "owner/repo/path#version") */
  id: string;
  /** Category */
  type: ApmDependencyType;
  /** Version/commit if specified, otherwise null */
  version: string | null;
  /** Source file path */
  source: string;
}

/** A warning or error encountered during scanning */
export interface ScanDiagnostic {
  /** Severity */
  level: "warning" | "error";
  /** File that caused the diagnostic */
  file: string;
  /** Short diagnostic kind */
  kind: string;
  /** Human-readable message */
  message: string;
}

/** Result returned by discoverDependencies() */
export interface DiscoveryResult {
  mcpServers: McpServer[];
  otherDependencies: OtherDependency[];
  diagnostics: ScanDiagnostic[];
}

/** Options for the discover function */
export interface DiscoverOptions {
  /** Whether to scan global user VS Code config (default: true) */
  includeGlobal?: boolean;
  /** Additional glob ignore patterns beyond the defaults */
  extraIgnores?: string[];
}

/** A single resolved dependency entry in a GitHub snapshot manifest */
export interface SnapshotDependency {
  package_url: string;
  relationship: "direct" | "indirect";
  dependencies?: string[];
}

/** A manifest entry in a GitHub Dependency Submission snapshot */
export interface SnapshotManifest {
  name: string;
  file?: string;
  resolved?: boolean;
  dependencies: SnapshotDependency[];
}

/** GitHub Dependency Submission API snapshot */
export interface DependencySnapshot {
  version: 0;
  job: { id: string; correlator: string };
  sha: string;
  ref: string;
  detector: { name: string; version: string; url: string };
  metadata?: Record<string, unknown>;
  manifests: Record<string, SnapshotManifest>;
}

/** Options for the convert function */
export interface ConvertOptions {
  /** Repository commit SHA (from GITHUB_SHA or --sha flag) */
  sha?: string;
  /** Git ref (from GITHUB_REF or --ref flag) */
  ref?: string;
  /** Job correlator string for deduplication */
  correlator?: string;
}
