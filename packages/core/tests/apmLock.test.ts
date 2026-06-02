import { describe, it, expect } from "vitest";
import * as path from "path";
import { fileURLToPath } from "url";
import { parseApmLock } from "../src/parsers/apmLock.js";
import type { ScanDiagnostic } from "../src/types.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURES = path.join(__dirname, "fixtures");

describe("parseApmLock", () => {
  it("parses apm.lock.yaml and returns resolved dependency map", () => {
    const diagnostics: ScanDiagnostic[] = [];
    const resolved = parseApmLock(path.join(FIXTURES, "apm.lock.yaml"), diagnostics);

    expect(diagnostics).toHaveLength(0);
    expect(resolved.size).toBe(2);

    const sample = resolved.get("microsoft/apm-sample-package")!;
    expect(sample).toBeDefined();
    expect(sample.version).toBe("v1.0.0");
    expect(sample.resolvedUrl).toBe("https://github.com/microsoft/apm-sample-package");
    expect(sample.commit).toBe("abc123def456");

    const simple = resolved.get("owner/simple-package")!;
    expect(simple.version).toBe("v0.2.1");
  });

  it("returns empty map silently for missing lockfile", () => {
    const diagnostics: ScanDiagnostic[] = [];
    const resolved = parseApmLock("/nonexistent/apm.lock.yaml", diagnostics);
    expect(resolved.size).toBe(0);
    expect(diagnostics).toHaveLength(0);
  });
});
