// Builds dist/uplayground-events.mcpb — a one-click Claude Desktop
// extension bundle (MCPB, formerly DXT). The stdio MCP server has zero
// npm dependencies, so the bundle is just the manifest plus bin/ + src/
// + package.json (required for "type": "module").
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const distDir = join(root, "dist");
const stageDir = join(distDir, "mcpb-stage");
const outFile = join(distDir, `uplayground-events-${pkg.version}.mcpb`);

const manifest = {
  manifest_version: "0.2",
  name: "uplayground-events",
  display_name: "UPlayground Events",
  version: pkg.version,
  description: "Live event discovery: concerts, club nights, art, comedy, and festivals across 14 cities.",
  long_description: "Search and get recommendations from UPlayground's live event inventory (Resident Advisor, Dice, Eventbrite, Luma, and city calendars). Includes consent-first preference profiles, night planning, ticket-offer lookup, and calendar files. No account or API key required.",
  author: {
    name: "UrbanPlayground",
    email: "support@urbanplayground.xyz",
    url: "https://www.dizko.app"
  },
  homepage: "https://www.dizko.app",
  documentation: "https://mcp.dizko.app/user-guide.html",
  support: "https://mcp.dizko.app/support.html",
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "bin/eventchat-events-mcp.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/bin/eventchat-events-mcp.js"]
    }
  },
  compatibility: {
    runtimes: { node: ">=20" }
  },
  keywords: ["events", "nightlife", "concerts", "festivals", "tickets", "mcp"],
  license: "UNLICENSED"
};

rmSync(stageDir, { recursive: true, force: true });
mkdirSync(stageDir, { recursive: true });

writeFileSync(join(stageDir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
cpSync(join(root, "bin"), join(stageDir, "bin"), { recursive: true });
cpSync(join(root, "src"), join(stageDir, "src"), { recursive: true });
cpSync(join(root, "public", "logo-512.png"), join(stageDir, "icon.png"));
// "type": "module" is what makes the bundled .js files parse as ESM.
writeFileSync(join(stageDir, "package.json"), JSON.stringify({
  name: pkg.name,
  version: pkg.version,
  type: "module",
  private: true
}, null, 2) + "\n");

rmSync(outFile, { force: true });
try {
  execFileSync("zip", ["-r", "-q", outFile, "."], { cwd: stageDir });
} catch (error) {
  console.error("Failed to run `zip`. Install zip (macOS/Linux ship it) and re-run.");
  throw error;
}
rmSync(stageDir, { recursive: true, force: true });

console.log(JSON.stringify({ ok: true, bundle: outFile, version: pkg.version }, null, 2));
