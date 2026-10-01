// Builds a Dizko Events one-click Claude Desktop extension bundle (MCPB,
// formerly DXT): the manifest, bin/ + src/, a package.json that keeps
// "type": "module", and the production dependency tree. The bundle must be
// self-contained - Claude Desktop unzips it and runs `node bin/dizko-mcp.js`
// with no install step, so a missing node_modules means the extension fails
// to start with ERR_MODULE_NOT_FOUND.
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CITY_TABLE } from "../src/cities.js";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const distDir = join(root, "dist");
const stageDir = join(distDir, "mcpb-stage");
const outFile = join(distDir, `dizko-events-${pkg.version}.mcpb`);

const manifest = {
  manifest_version: "0.2",
  name: "dizko-events",
  display_name: "Dizko Events",
  version: pkg.version,
  // The city count comes from the same table the server uses, so the bundle
  // description cannot drift from coverage.
  description: `Live event discovery: concerts, club nights, art, comedy, and festivals across ${CITY_TABLE.length} cities.`,
  long_description: "Search and get recommendations from Dizko's live event inventory (Resident Advisor, Dice, Eventbrite, Luma, and city calendars), with every time in the city's local timezone. Includes DJ, venue and promoter lookups, daily city roundups, night planning, consent-first preference profiles, ticket-offer lookup, and calendar files. No account or API key required.",
  author: {
    name: "Dizko",
    email: "support@dizko.app",
    url: "https://www.dizko.app"
  },
  homepage: "https://www.dizko.app",
  documentation: "https://mcp.dizko.app/user-guide.html",
  support: "https://mcp.dizko.app/support.html",
  icon: "icon.png",
  server: {
    type: "node",
    entry_point: "bin/dizko-mcp.js",
    mcp_config: {
      command: "node",
      args: ["${__dirname}/bin/dizko-mcp.js"]
    }
  },
  compatibility: {
    runtimes: { node: ">=20" }
  },
  keywords: ["events", "nightlife", "concerts", "festivals", "tickets", "mcp"],
  license: "MIT"
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
  private: true,
  dependencies: pkg.dependencies
}, null, 2) + "\n");

// Copy the production dependency tree. `npm ls --omit=dev` resolves the real
// install (including transitive packages and any hoisting), so the bundle
// matches what the tests ran against instead of a guessed list.
const depPaths = execFileSync("npm", ["ls", "--omit=dev", "--all", "--parseable"], { cwd: root, encoding: "utf8" })
  .split("\n")
  .map((line) => line.trim())
  .filter((line) => line.includes(`${sep}node_modules${sep}`));

if (!depPaths.length) {
  throw new Error("No production dependencies resolved. Run `npm install` before building the bundle.");
}
for (const source of depPaths) {
  const relative = source.slice(root.length + 1);
  cpSync(source, join(stageDir, relative), { recursive: true, dereference: true });
}
for (const required of Object.keys(pkg.dependencies || {})) {
  if (!existsSync(join(stageDir, "node_modules", required, "package.json"))) {
    throw new Error(`Bundle is missing dependency ${required}; the extension would not start.`);
  }
}

rmSync(outFile, { force: true });
try {
  execFileSync("zip", ["-r", "-q", outFile, "."], { cwd: stageDir });
} catch (error) {
  console.error("Failed to run `zip`. Install zip (macOS/Linux ship it) and re-run.");
  throw error;
}
rmSync(stageDir, { recursive: true, force: true });

console.log(JSON.stringify({ ok: true, bundle: outFile, version: pkg.version, bundled_dependencies: depPaths.length }, null, 2));
