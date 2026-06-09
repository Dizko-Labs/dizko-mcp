import { getConfig, SUPPORTED_CITIES } from "./config.js";
import { getEvent, searchEvents } from "./api.js";
import { formatEventList, summarizeEvent } from "./format.js";
import { planNight, recommendEvents } from "./planner.js";

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
      case "get": {
        const id = args[0];
        if (!id || id.startsWith("--")) throw new Error("Usage: eventchat-events get <event-id>");
        const event = await getEvent(id);
        io.stdout.write(JSON.stringify(summarizeEvent(event, { webBaseUrl: config.webBaseUrl }), null, 2) + "\n");
        break;
      }
      case "cities":
        io.stdout.write(SUPPORTED_CITIES.join("\n") + "\n");
        break;
      case "help":
      case undefined:
        io.stdout.write(helpText());
        break;
      default:
        throw new Error(`Unknown command: ${command}\n\n${helpText()}`);
    }
  } catch (error) {
    io.stderr.write(`${error.message}\n`);
    return 1;
  }

  return 0;
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

  for (const key of ["genres", "vibe", "event_types", "event_type", "neighborhoods", "avoid"]) {
    if (typeof parsed[key] === "string") {
      parsed[key] = parsed[key].split(",").map((item) => item.trim()).filter(Boolean);
    }
  }

  return parsed;
}

export function helpText() {
  return `eventchat-events

Commands:
  search       Print live matching events.
  recommend    Return ranked JSON with recommendation reasons.
  plan         Return a compact night plan with fallbacks.
  get <id>     Fetch one event.
  cities       List supported cities.

Examples:
  eventchat-events search --city berlin --when weekend --genres techno --limit 5
  eventchat-events recommend --city new-york --when tonight --vibe underground,intimate --max-price 30
  eventchat-events plan --city london --when weekend --event-types party --avoid mainstream

Environment:
  EVENTCHAT_API_BASE_URL overrides the API base URL.
  EVENTCHAT_WEB_BASE_URL overrides public event links.
`;
}

function coerceValue(value) {
  if (value === "true") return true;
  if (value === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}
