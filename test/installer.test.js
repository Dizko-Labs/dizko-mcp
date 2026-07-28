import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { DEFAULT_MCP_URL } from "../src/config.js";
import {
  claudeDesktopConfigPath,
  cursorConfigPath,
  installIntoJsonConfig,
  runInstall,
  stdioServerEntry
} from "../src/installer.js";

test("installIntoJsonConfig creates a fresh config file with our server", async () => {
  const dir = await mkdtemp(join(tmpdir(), "upg-install-"));
  const path = join(dir, "nested", "claude_desktop_config.json");

  const result = await installIntoJsonConfig(path, stdioServerEntry());
  assert.equal(result.created, true);
  assert.equal(result.alreadyInstalled, false);
  assert.equal(result.backupPath, null);

  const written = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(written.mcpServers["uplayground-events"], {
    command: "npx",
    args: ["-y", "uplayground-events", "mcp"]
  });
});

test("installIntoJsonConfig merges into an existing config and writes a backup", async () => {
  const dir = await mkdtemp(join(tmpdir(), "upg-install-"));
  const path = join(dir, "config.json");
  await writeFile(path, JSON.stringify({
    theme: "dark",
    mcpServers: { other: { command: "other-server" } }
  }));

  const result = await installIntoJsonConfig(path, stdioServerEntry());
  assert.equal(result.created, false);
  assert.equal(result.backupPath, `${path}.bak`);

  const written = JSON.parse(await readFile(path, "utf8"));
  assert.equal(written.theme, "dark", "unrelated settings must survive");
  assert.deepEqual(written.mcpServers.other, { command: "other-server" }, "other servers must survive");
  assert.ok(written.mcpServers["uplayground-events"]);

  const backup = JSON.parse(await readFile(`${path}.bak`, "utf8"));
  assert.equal(backup.mcpServers["uplayground-events"], undefined, "backup holds the pre-install state");
});

test("installIntoJsonConfig refuses to clobber invalid JSON", async () => {
  const dir = await mkdtemp(join(tmpdir(), "upg-install-"));
  const path = join(dir, "config.json");
  await writeFile(path, "{not json");
  await assert.rejects(installIntoJsonConfig(path, stdioServerEntry()), /not valid JSON/);
});

test("runInstall cursor writes the hosted endpoint url", async () => {
  const dir = await mkdtemp(join(tmpdir(), "upg-install-"));
  const path = join(dir, "mcp.json");
  const output = [];

  await runInstall("cursor", { configPath: path, write: (text) => output.push(text) });

  const written = JSON.parse(await readFile(path, "utf8"));
  assert.deepEqual(written.mcpServers["uplayground-events"], { url: DEFAULT_MCP_URL });
  assert.match(output.join("\n"), /Restart Cursor/);
});

test("runInstall claude-code prints the one-line add command", async () => {
  const output = [];
  await runInstall("claude-code", { write: (text) => output.push(text) });
  assert.match(output.join("\n"), /claude mcp add --transport http uplayground-events https:\/\//);
});

test("runInstall with no target prints an overview with all targets", async () => {
  const output = [];
  await runInstall(undefined, { write: (text) => output.push(text) });
  const text = output.join("\n");
  for (const target of ["claude-desktop", "cursor", "claude-code", "claude-ai", "chatgpt"]) {
    assert.match(text, new RegExp(target));
  }
  assert.match(text, /npx -y uplayground-events mcp|"uplayground-events", "mcp"/);
});

test("install overview leads with the hosted connector and flags local access", async () => {
  const output = [];
  await runInstall(undefined, { write: (text) => output.push(text) });
  const text = output.join("\n");
  assert.match(text, /Easiest \+ safest: add the hosted connector/);
  assert.ok(text.indexOf("hosted connector") < text.indexOf("LOCAL MCP server"), "hosted path must come before the local one");
  assert.match(text, /can access your computer/);
});

test("claude-desktop install warns about local access and points to the hosted connector", async () => {
  const dir = await mkdtemp(join(tmpdir(), "upg-install-"));
  const output = [];
  await runInstall("claude-desktop", { configPath: join(dir, "claude_desktop_config.json"), write: (text) => output.push(text) });
  const text = output.join("\n");
  assert.match(text, /can access your computer/);
  assert.match(text, /hosted connector/);
  assert.match(text, /mcp\.dizko\.app\/mcp/);
});

test("runInstall rejects unknown targets with the overview", async () => {
  await assert.rejects(runInstall("vim", { write: () => {} }), /Unknown install target: vim/);
});

test("config paths resolve per-OS", () => {
  assert.match(claudeDesktopConfigPath({ os: "darwin", home: "/Users/x", env: {} }), /Library\/Application Support\/Claude\/claude_desktop_config\.json$/);
  assert.match(claudeDesktopConfigPath({ os: "linux", home: "/home/x", env: {} }), /\.config\/Claude\/claude_desktop_config\.json$/);
  assert.match(claudeDesktopConfigPath({ os: "win32", home: "C:\\Users\\x", env: { APPDATA: "C:\\Users\\x\\AppData\\Roaming" } }), /Claude/);
  assert.match(cursorConfigPath({ home: "/Users/x" }), /\.cursor\/mcp\.json$/);
});
