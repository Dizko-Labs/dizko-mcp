#!/usr/bin/env node
// Validates openai-plugin/ against the ChatGPT and Codex plugin directory
// limits, checks the declared MCP endpoint serves exactly the reviewed tool
// surface, then zips the package to dist/. Pass --offline to skip the live
// endpoint check.
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { surfaceTools } from "../src/surfaces.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pluginDir = join(root, "openai-plugin");
const offline = process.argv.includes("--offline");
const CATEGORIES = ["Productivity", "Creativity", "Developer Tools", "Business & Operations", "Data & Analytics", "Communication", "Education & Research", "Security", "Finance", "Healthcare", "Travel", "Entertainment", "Other"];

const errors = [];
const check = (condition, message) => { if (!condition) errors.push(message); };
const oneLine = (value) => typeof value === "string" && value.trim() && !/[\n\r\u2028\u2029]/.test(value);
const https = (value) => { try { const url = new URL(value); return url.protocol === "https:" && !url.username && value.length <= 1024; } catch { return false; } };

const manifest = JSON.parse(readFileSync(join(pluginDir, "plugin.json"), "utf8"));
const mcp = JSON.parse(readFileSync(join(pluginDir, "mcp.json"), "utf8"));
const ui = manifest.extensions?.["com.openai"]?.interface || {};

check(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(manifest.name || ""), "name must be 1-64 ASCII letters, digits, _ or -");
check(/^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/.test(manifest.version || "") && manifest.version.length <= 64, "version must be semver");
check(oneLine(manifest.description), "description is required");
check(oneLine(manifest.author?.name) && manifest.author.name.length <= 80, "author.name is required, max 80");
check(oneLine(ui.displayName) && ui.displayName.length <= 30, "displayName is required, one line, max 30");
check(oneLine(ui.shortDescription) && ui.shortDescription.length <= 30, "shortDescription is required, one line, max 30");
check(typeof ui.longDescription === "string" && ui.longDescription.trim() && ui.longDescription.length <= 4000, "longDescription is required, max 4000");
check(oneLine(ui.developerName) && ui.developerName.length <= 80, "developerName is required, one line, max 80");
check(CATEGORIES.includes(ui.category), `category must be one of: ${CATEGORIES.join(", ")}`);
check(Array.isArray(ui.capabilities) && ui.capabilities.length <= 20 && ui.capabilities.every((item) => oneLine(item) && item.length <= 120), "capabilities: max 20, each one line max 120");
check(!/(^|\s)(MCP|MCP Server|Plugin)$/i.test(ui.displayName), "displayName must not end in MCP, MCP Server, or Plugin");
const prompts = ui.defaultPrompt || [];
check(prompts.length <= 3 && prompts.every((prompt) => oneLine(prompt) && prompt.length <= 128 && !prompt.includes("@")), "defaultPrompt: max 3, each max 128, no @mentions");
check(new Set(prompts.map((prompt) => prompt.toLowerCase().replace(/\W+/g, " ").trim())).size === prompts.length, "defaultPrompt entries must be unique");
for (const key of ["websiteURL", "supportURL", "privacyPolicyURL", "termsOfServiceURL"]) check(https(ui[key]), `${key} must be an HTTPS URL`);
check(/^#[0-9A-Fa-f]{6}$/.test(ui.brandColor || ""), "brandColor must be a six-digit hex color");
if (ui.brandColor) {
  check(contrast(ui.brandColor, "#FFFFFF") >= 2, "brandColor needs 2:1 contrast against white");
  check(contrast(ui.brandColor, "#212121") >= 2, "brandColor needs 2:1 contrast against #212121");
}
const copy = [manifest.description, ui.shortDescription, ui.longDescription, ...prompts].join("\n");
check(!copy.includes("\u2014"), "listing copy must not contain em dashes");
check(!/\b(free trial|discount|subscribe|subscription|promo code|% off)\b/i.test(copy), "listing copy must not advertise pricing or promotions");

for (const key of ["logo", "composerIcon"]) {
  const path = ui[key];
  check(typeof path === "string" && path.startsWith("./") && !path.includes(".."), `${key} must be a ./ path inside the package`);
  const file = join(pluginDir, path || "");
  if (!existsSync(file)) { errors.push(`${key} file ${path} is missing`); continue; }
  const png = readFileSync(file);
  const width = png.readUInt32BE(16);
  const height = png.readUInt32BE(20);
  check(png.subarray(1, 4).toString() === "PNG", `${key} must be a PNG`);
  check(width === height && width >= 48 && width <= 4096, `${key} must be square, 48-4096px (got ${width}x${height})`);
  check(png.length <= 5 * 1024 * 1024, `${key} must be at most 5 MiB`);
}

const servers = Object.entries(mcp.mcpServers || {});
check(servers.length === 1, "mcp.json must declare exactly one server");
const [, server] = servers[0] || [];
check(server?.type === "streamable-http" && https(server?.url || ""), "MCP server must be streamable-http on HTTPS");

const expected = surfaceTools("openai").map((tool) => tool.name).sort();
if (!offline && server?.url) {
  const live = await listLiveTools(server.url).catch((error) => { errors.push(`live tools/list failed: ${error.message}`); return null; });
  if (live) {
    check(JSON.stringify(live.map((tool) => tool.name).sort()) === JSON.stringify(expected), `live endpoint tools differ from the reviewed surface: ${live.map((tool) => tool.name).sort().join(", ")}`);
    for (const tool of live) {
      const hints = tool.annotations || {};
      check(["readOnlyHint", "destructiveHint", "openWorldHint"].every((key) => typeof hints[key] === "boolean"), `${tool.name} must set readOnlyHint, destructiveHint, and openWorldHint`);
    }
  }
}

if (errors.length) {
  console.error(JSON.stringify({ ok: false, errors }, null, 2));
  process.exit(1);
}

const outDir = join(root, "dist");
const zipPath = join(outDir, `${manifest.name}-openai-plugin-${manifest.version}.zip`);
mkdirSync(outDir, { recursive: true });
rmSync(zipPath, { force: true });
execFileSync("zip", ["-r", "-X", "-q", zipPath, ".", "-x", ".*", "-x", "*/.*"], { cwd: pluginDir });
console.log(JSON.stringify({ ok: true, zip: zipPath, endpoint: server.url, tools: expected.length, live_checked: !offline }, null, 2));

async function listLiveTools(url) {
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    signal: AbortSignal.timeout(15_000)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const text = await response.text();
  const body = text.trimStart().startsWith("event:") ? text.split("\n").find((line) => line.startsWith("data:")).slice(5) : text;
  return JSON.parse(body).result.tools;
}

function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
