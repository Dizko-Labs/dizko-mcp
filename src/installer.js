import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join } from "node:path";
import { getConfig } from "./config.js";

export const SERVER_NAME = "uplayground-events";

// One canonical stdio snippet everywhere: `npx -y uplayground-events mcp`.
export function stdioServerEntry() {
  return { command: "npx", args: ["-y", "uplayground-events", "mcp"] };
}

export function claudeDesktopConfigPath({ env = process.env, os = platform(), home = homedir() } = {}) {
  if (os === "darwin") return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
  if (os === "win32") return join(env.APPDATA || join(home, "AppData", "Roaming"), "Claude", "claude_desktop_config.json");
  return join(env.XDG_CONFIG_HOME || join(home, ".config"), "Claude", "claude_desktop_config.json");
}

export function cursorConfigPath({ home = homedir() } = {}) {
  return join(home, ".cursor", "mcp.json");
}

// Merges our server into an mcp.json-style config file, creating it if
// missing and writing a .bak of the previous contents before any change.
export async function installIntoJsonConfig(path, serverEntry, { fs = { readFile, writeFile, mkdir, copyFile } } = {}) {
  let existing = null;
  try {
    existing = await fs.readFile(path, "utf8");
  } catch {
    existing = null;
  }

  let config = {};
  if (existing !== null) {
    try {
      config = JSON.parse(existing);
    } catch {
      throw new Error(`${path} exists but is not valid JSON. Fix or remove it, then re-run install.`);
    }
    if (!config || typeof config !== "object" || Array.isArray(config)) {
      throw new Error(`${path} exists but is not a JSON object. Fix or remove it, then re-run install.`);
    }
  }

  const servers = config.mcpServers && typeof config.mcpServers === "object" ? config.mcpServers : {};
  const alreadyInstalled = Boolean(servers[SERVER_NAME]);
  const updated = {
    ...config,
    mcpServers: {
      ...servers,
      [SERVER_NAME]: serverEntry
    }
  };

  await fs.mkdir(dirname(path), { recursive: true });
  if (existing !== null) {
    await fs.copyFile(path, `${path}.bak`);
  }
  await fs.writeFile(path, JSON.stringify(updated, null, 2) + "\n");

  return { path, created: existing === null, alreadyInstalled, backupPath: existing !== null ? `${path}.bak` : null };
}

export async function runInstall(target, options = {}) {
  const config = options.config || getConfig(options.env);
  const write = options.write || (() => {});

  switch ((target || "").toLowerCase()) {
    case "claude-desktop": {
      const path = options.configPath || claudeDesktopConfigPath(options);
      const result = await installIntoJsonConfig(path, stdioServerEntry(), options);
      write([
        `${result.alreadyInstalled ? "Updated" : "Added"} "${SERVER_NAME}" in ${result.path}`,
        result.backupPath ? `Previous config backed up to ${result.backupPath}` : "Created a new config file.",
        "Fully quit and reopen Claude Desktop to load it (requires Node via npx on first run).",
        "Tip: claude.ai paid plans can skip this entirely — Settings -> Connectors -> Add custom connector:",
        `  ${config.mcpUrl}`
      ].join("\n"));
      return { ok: true, ...result };
    }
    case "cursor": {
      const path = options.configPath || cursorConfigPath(options);
      const result = await installIntoJsonConfig(path, { url: config.mcpUrl }, options);
      write([
        `${result.alreadyInstalled ? "Updated" : "Added"} "${SERVER_NAME}" in ${result.path}`,
        result.backupPath ? `Previous config backed up to ${result.backupPath}` : "Created a new config file.",
        "Restart Cursor (or toggle the server in Cursor Settings -> MCP) to load it."
      ].join("\n"));
      return { ok: true, ...result };
    }
    case "claude-code": {
      write([
        "Run this in your terminal:",
        "",
        `  claude mcp add --transport http ${SERVER_NAME} ${config.mcpUrl}`
      ].join("\n"));
      return { ok: true };
    }
    case "claude-ai":
    case "chatgpt": {
      write([
        "No install needed — add the hosted endpoint as a connector:",
        "",
        `  ${config.mcpUrl}`,
        "",
        "claude.ai: Settings -> Connectors -> Add custom connector (paid plans).",
        "ChatGPT: Settings -> Apps & Connectors -> Advanced -> Developer mode -> Add connector."
      ].join("\n"));
      return { ok: true };
    }
    case "":
    case undefined: {
      write(installOverview(config));
      return { ok: true };
    }
    default:
      throw new Error(`Unknown install target: ${target}\n\n${installOverview(config)}`);
  }
}

export function installOverview(config) {
  return [
    "uplayground-events install <target>",
    "",
    "Targets:",
    "  claude-desktop   Write the local MCP server into claude_desktop_config.json",
    "  cursor           Write the hosted endpoint into ~/.cursor/mcp.json",
    "  claude-code      Print the one-line `claude mcp add` command",
    "  claude-ai        Show claude.ai connector steps (no install needed)",
    "  chatgpt          Show ChatGPT developer-mode connector steps",
    "",
    "Hosted MCP endpoint (works in any remote-MCP client, no auth):",
    `  ${config.mcpUrl}`,
    "",
    "Local stdio server snippet for any MCP client config:",
    `  { "command": "npx", "args": ["-y", "uplayground-events", "mcp"] }`
  ].join("\n");
}
