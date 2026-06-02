import * as os from "os";
import * as path from "path";

/**
 * Returns candidate paths for the global VS Code user directory.
 * Covers stable, Insiders, and OSS/Codium builds.
 */
function getVSCodeUserDirs(): string[] {
  const home = os.homedir();

  if (process.platform === "win32") {
    const appData = process.env.APPDATA ?? path.join(home, "AppData", "Roaming");
    return [
      path.join(appData, "Code", "User"),
      path.join(appData, "Code - Insiders", "User"),
      path.join(appData, "VSCodium", "User"),
    ];
  }

  if (process.platform === "darwin") {
    const support = path.join(home, "Library", "Application Support");
    return [
      path.join(support, "Code", "User"),
      path.join(support, "Code - Insiders", "User"),
      path.join(support, "VSCodium", "User"),
    ];
  }

  // Linux and other POSIX
  const configBase = process.env.XDG_CONFIG_HOME ?? path.join(home, ".config");
  return [
    path.join(configBase, "Code", "User"),
    path.join(configBase, "Code - Insiders", "User"),
    path.join(configBase, "VSCodium", "User"),
  ];
}

/**
 * Returns candidate paths to standalone mcp.json files at the global user level.
 * Each path may or may not exist; callers should check with fs.existsSync.
 */
export function getGlobalMcpJsonPaths(): string[] {
  return getVSCodeUserDirs().map((dir) => path.join(dir, "mcp.json"));
}

/**
 * Returns candidate paths to settings.json files that may contain mcp.servers.
 */
export function getGlobalSettingsJsonPaths(): string[] {
  return getVSCodeUserDirs().map((dir) => path.join(dir, "settings.json"));
}
