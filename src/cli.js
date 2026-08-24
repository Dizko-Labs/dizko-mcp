import { getConfig, SUPPORTED_CITIES } from "./config.js";
import { EventChatAPIError, getEvent, searchEvents } from "./api.js";
import { formatDoctorReport, runDoctor } from "./doctor.js";
import { formatEventList, summarizeEvent } from "./format.js";
import { runInstall } from "./installer.js";
import { runMcpServer } from "./mcpServer.js";
import { planNight, recommendEvents } from "./planner.js";
import { dailyRoundup } from "./roundup.js";
import { getArtistEvents } from "./artistEvents.js";
import { cityPulse } from "./cityPulse.js";

export async function runCli(argv = process.argv.slice(2), io = process) {
  const [command, ...args] = argv;
  const options = parseArgs(args);
  const config = getConfig();

  try {
    switch (command) {
      case "search": {
        const response = await searchEvents(options);
        io.stdout.write(formatEventList(response.events || [], { webBaseUrl: config.webBaseUrl }) + "\n");
        break;
      }
      case "recommend": {
        const response = await recommendEvents(options);
        io.stdout.write(JSON.stringify(response, null, 2) + "\n");
        break;
      }
      case "plan": {
        const response = await planNight(options);
        io.stdout.write(JSON.stringify(response, null, 2) + "\n");
        break;
      }
      case "roundup": {
        const response = await dailyRoundup(options);
        io.stdout.write(JSON.stringify(response, null, 2) + "\n");
        break;
      }
      case "artists": {
        const response = await getArtistEvents(options);
        io.stdout.write(JSON.stringify(response, null, 2) + "\n");
        break;
      }
      case "pulse": {
        const response = await cityPulse(options);
        io.stdout.write(JSON.stringify(response, null, 2) + "\n");
        break;
      }
      case "get": {
        const id = args[0];
        if (!id || id.startsWith("--")) throw new Error("Usage: dizko-events get <event-id>");
        const event = await getEvent(id);
        io.stdout.write(JSON.stringify(summarizeEvent(event, { webBaseUrl: config.webBaseUrl }), null, 2) + "\n");
        break;
      }
      case "cities":
        io.stdout.write(SUPPORTED_CITIES.join("\n") + "\n");
        break;
      case "doctor": {
        const report = await runDoctor();
        io.stdout.write(options.json ? JSON.stringify(report, null, 2) + "\n" : formatDoctorReport(report) + "\n");
        return report.ok ? 0 : 1;
      }
      case "mcp":
        await runMcpServer();
        break;
      case "serve": {
        const { runHttpMcpServer } = await import("./httpServer.js");
        await runHttpMcpServer();
        break;
      }
      case "install": {
        const target = args[0] && !args[0].startsWith("--") ? args[0] : undefined;
        await runInstall(target, { write: (text) => io.stdout.write(text + "\n") });
        break;
      }
      case "help":
      case "--help":
      case "-h":
      case undefined:
        io.stdout.write(helpText());
        break;
      default:
        throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
    }
  } catch (error) {
    io.stderr.write(formatCliError(error) + "\n");
    return 1;
  }

  return 0;
}

export function formatCliError(error) {
  const lines = [error.message];
  if (error.code) lines.push(`  code: ${error.code}`);
  if (error.status != null) lines.push(`  status: HTTP ${error.status}`);
  if (error.hostname) lines.push(`  host: ${error.hostname}`);
  if (error.url) lines.push(`  url: ${error.url}`);
  if (error.retryable) lines.push("  retryable: yes - this is usually temporary, try again shortly");
  if (error instanceof EventChatAPIError) {
    lines.push("  hint: run `dizko-events doctor` to diagnose connectivity");
  }
  return lines.join("\n");
}

export function parseArgs(args) {
  const parsed = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-/g, "_");
    const next = args[index + 1];
    if (next === undefined || next.startsWith("--")) {
      parsed[key] = true;
    } else {
      parsed[key] = coerceValue(next);
      index += 1;
    }
  }

  for (const key of ["genres", "vibe", "event_types", "event_type", "neighborhoods", "avoid", "artists"]) {
    if (typeof parsed[key] === "string") {
      parsed[key] = parsed[key].split(",").map((item) => item.trim()).filter(Boolean);
    }
  }

  return parsed;
}

export function helpText() {
  return `dizko-events

Commands:
  search       Print live matching events.
  recommend    Return ranked JSON with recommendation reasons.
  plan         Return a compact night plan with fallbacks.
  roundup      Daily digest for a city: top picks + category sections.
  artists      Upcoming events per artist (--artists "Ben Klock,Marcel Dettmann").
  pulse        Aggregate momentum for a city: busiest nights, venues, genres.
  get <id>     Fetch one event.
  cities       List supported cities.
  install      Set up an MCP client: install claude-desktop | cursor | claude-code | claude-ai | chatgpt.
  mcp          Run the local stdio MCP server (package command: npx -y dizko-events mcp).
  serve        Run the HTTP MCP server (same as the hosted endpoint).
  doctor       Diagnose connectivity (DNS, health, MCP endpoint, live search). Add --json for machine-readable output.
  help         Show this help (also --help / -h).

Examples:
  dizko-events search --city "los angeles" --when "this week" --limit 5
  dizko-events recommend --city new-york --when tonight --vibe underground,intimate --max-price 30
  dizko-events plan --city london --when weekend --event-types party --avoid mainstream
  dizko-events roundup --city berlin --when today
  dizko-events install claude-desktop
  dizko-events doctor

Environment:
  DIZKO_API_BASE_URL            overrides the events API base URL.
  DIZKO_WEB_BASE_URL            overrides public event links.
  DIZKO_MCP_URL                 overrides the hosted MCP endpoint.
  DIZKO_API_TIMEOUT_MS          per-request timeout (default 8000).
  DIZKO_API_RETRIES             retries for transient network/5xx failures (default 2).
  DIZKO_API_RETRY_BASE_DELAY_MS backoff base delay (default 250).
`;
}

function coerceValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
