import * as fs from "fs";
import * as yaml from "js-yaml";
import type { ScanDiagnostic } from "../types.js";

/**
 * Shape of the resolved packages in apm.lock.yaml.
 * The actual format may vary; this covers a likely schema.
 */
interface ApmLockPackage {
  version?: string;
  resolved?: string;
  commit?: string;
  [key: string]: unknown;
}

interface ApmLockYml {
  packages?: Record<string, ApmLockPackage>;
  dependencies?: Record<string, ApmLockPackage>;
  [key: string]: unknown;
}

export interface ResolvedDependency {
  id: string;
  version: string | null;
  resolvedUrl: string | null;
  commit: string | null;
}

/**
 * Parses an apm.lock.yaml file and returns a map of id → resolved info.
 * Returns an empty map if the file doesn't exist or fails to parse.
 */
export function parseApmLock(
  filePath: string,
  diagnostics: ScanDiagnostic[]
): Map<string, ResolvedDependency> {
  const result = new Map<string, ResolvedDependency>();

  let raw: string;
  try {
    raw = fs.readFileSync(filePath, "utf-8");
  } catch {
    // Lock file is optional; absence is not an error
    return result;
  }

  let parsed: ApmLockYml;
  try {
    parsed = (yaml.load(raw) as ApmLockYml) ?? {};
  } catch (err) {
    diagnostics.push({
      level: "warning",
      file: filePath,
      kind: "yaml-parse-error",
      message: `Could not parse apm.lock.yaml: ${(err as Error).message}`,
    });
    return result;
  }

  // Support both "packages" and "dependencies" as the top-level key
  const entries = parsed?.packages ?? parsed?.dependencies ?? {};
  for (const [id, pkg] of Object.entries(entries)) {
    if (typeof pkg !== "object" || pkg === null) continue;
    result.set(id, {
      id,
      version: (pkg.version as string) ?? null,
      resolvedUrl: (pkg.resolved as string) ?? null,
      commit: (pkg.commit as string) ?? null,
    });
  }

  return result;
}
