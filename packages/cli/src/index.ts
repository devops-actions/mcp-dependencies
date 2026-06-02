#!/usr/bin/env node
import { Command } from "commander";
import * as fs from "fs";
import * as path from "path";
import { discoverDependencies, convertToSnapshot } from "@mcp-dependencies/core";
import type { DiscoveryResult } from "@mcp-dependencies/core";

const pkg = JSON.parse(
  fs.readFileSync(new URL("../package.json", import.meta.url), "utf-8")
) as { version: string; description: string };

const program = new Command();

program
  .name("mcp-apm-scan")
  .description(pkg.description)
  .version(pkg.version);

// ─── discover ────────────────────────────────────────────────────────────────
program
  .command("discover")
  .description(
    "Scan the current directory for MCP server configs and APM manifests, output discovery JSON"
  )
  .option("-o, --output <file>", "Write output to file instead of stdout")
  .option(
    "--no-global",
    "Skip scanning global VS Code user config directories"
  )
  .option(
    "--cwd <dir>",
    "Root directory to scan (default: current working directory)",
    process.cwd()
  )
  .option("--verbose", "Print diagnostics to stderr", false)
  .action(async (opts: { output?: string; global: boolean; cwd: string; verbose: boolean }) => {
    const result = await discoverDependencies(opts.cwd, {
      includeGlobal: opts.global,
    });

    if (opts.verbose && result.diagnostics.length > 0) {
      for (const d of result.diagnostics) {
        process.stderr.write(`[${d.level.toUpperCase()}] ${d.file}: ${d.message}\n`);
      }
    }

    const json = JSON.stringify(result, null, 2);

    if (opts.output) {
      fs.writeFileSync(path.resolve(opts.output), json, "utf-8");
      process.stderr.write(`Discovery result written to ${opts.output}\n`);
    } else {
      process.stdout.write(json + "\n");
    }
  });

// ─── convert ─────────────────────────────────────────────────────────────────
program
  .command("convert")
  .description(
    "Convert a discovery JSON file (from 'discover') into a GitHub Dependency Submission API snapshot"
  )
  .argument("[input]", "Path to discovery JSON file (default: read from stdin)")
  .option("-o, --output <file>", "Write snapshot JSON to file instead of stdout")
  .option("--sha <sha>", "Git commit SHA (default: GITHUB_SHA env var)")
  .option("--ref <ref>", "Git ref (default: GITHUB_REF env var or refs/heads/main)")
  .option("--correlator <id>", "Job correlator for deduplication (default: GITHUB_WORKFLOW env var)")
  .action(
    async (
      input: string | undefined,
      opts: { output?: string; sha?: string; ref?: string; correlator?: string }
    ) => {
      let raw: string;

      if (input) {
        try {
          raw = fs.readFileSync(path.resolve(input), "utf-8");
        } catch (err) {
          process.stderr.write(`Error reading input file: ${(err as Error).message}\n`);
          process.exit(1);
        }
      } else {
        // Read from stdin
        raw = await readStdin();
      }

      let discoveryResult: DiscoveryResult;
      try {
        discoveryResult = JSON.parse(raw) as DiscoveryResult;
      } catch (err) {
        process.stderr.write(`Error parsing discovery JSON: ${(err as Error).message}\n`);
        process.exit(1);
      }

      const snapshot = convertToSnapshot(discoveryResult, {
        sha: opts.sha,
        ref: opts.ref,
        correlator: opts.correlator,
      });

      const json = JSON.stringify(snapshot, null, 2);

      if (opts.output) {
        fs.writeFileSync(path.resolve(opts.output), json, "utf-8");
        process.stderr.write(`Snapshot written to ${opts.output}\n`);
      } else {
        process.stdout.write(json + "\n");
      }
    }
  );

// ─── scan (one-shot: discover + convert) ────────────────────────────────────
program
  .command("scan")
  .description("Discover dependencies and immediately convert to GitHub snapshot (one-shot)")
  .option("-o, --output <file>", "Write snapshot JSON to file instead of stdout")
  .option("--no-global", "Skip scanning global VS Code user config directories")
  .option("--cwd <dir>", "Root directory to scan", process.cwd())
  .option("--sha <sha>", "Git commit SHA")
  .option("--ref <ref>", "Git ref")
  .option("--verbose", "Print diagnostics to stderr", false)
  .action(
    async (opts: {
      output?: string;
      global: boolean;
      cwd: string;
      sha?: string;
      ref?: string;
      verbose: boolean;
    }) => {
      const result = await discoverDependencies(opts.cwd, {
        includeGlobal: opts.global,
      });

      if (opts.verbose && result.diagnostics.length > 0) {
        for (const d of result.diagnostics) {
          process.stderr.write(`[${d.level.toUpperCase()}] ${d.file}: ${d.message}\n`);
        }
      }

      const snapshot = convertToSnapshot(result, {
        sha: opts.sha,
        ref: opts.ref,
      });

      const json = JSON.stringify(snapshot, null, 2);

      if (opts.output) {
        fs.writeFileSync(path.resolve(opts.output), json, "utf-8");
        process.stderr.write(`Snapshot written to ${opts.output}\n`);
      } else {
        process.stdout.write(json + "\n");
      }
    }
  );

program.parse();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function readStdin(): Promise<string> {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", (chunk: string) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}
