import assert from "node:assert/strict";
import test from "node:test";
import { EventChatNetworkError } from "../src/api.js";
import { formatCliError, helpText, runCli } from "../src/cli.js";

function fakeIo() {
  const out = [];
  const err = [];
  return {
    stdout: { write: (text) => out.push(text) },
    stderr: { write: (text) => err.push(text) },
    stdoutText: () => out.join(""),
    stderrText: () => err.join("")
  };
}

test("help, --help, -h, and no command all print usage and exit 0", async () => {
  for (const argv of [["help"], ["--help"], ["-h"], []]) {
    const io = fakeIo();
    const code = await runCli(argv, io);
    assert.equal(code, 0, `argv ${JSON.stringify(argv)} should exit 0`);
    assert.match(io.stdoutText(), /Commands:/);
    assert.match(io.stdoutText(), /search/);
    assert.match(io.stdoutText(), /doctor/);
    assert.equal(io.stderrText(), "");
  }
});

test("help text documents endpoint and retry environment variables", () => {
  const text = helpText();
  assert.match(text, /EVENTCHAT_API_BASE_URL/);
  assert.match(text, /EVENTCHAT_MCP_URL/);
  assert.match(text, /EVENTCHAT_API_RETRIES/);
});

test("unknown commands exit 1 and include usage", async () => {
  const io = fakeIo();
  const code = await runCli(["frobnicate"], io);
  assert.equal(code, 1);
  assert.match(io.stderrText(), /Unknown command: frobnicate/);
  assert.match(io.stderrText(), /Commands:/);
});

test("formatCliError includes code, host, url, retryability, and a doctor hint", () => {
  const error = new EventChatNetworkError("Event search failed: DNS lookup for backend.example.test failed (EAI_AGAIN).", {
    code: "EAI_AGAIN",
    hostname: "backend.example.test",
    url: "https://backend.example.test/events?city=los+angeles",
    classification: "dns",
    retryable: true
  });
  const text = formatCliError(error);
  assert.match(text, /DNS lookup for backend\.example\.test/);
  assert.match(text, /code: EAI_AGAIN/);
  assert.match(text, /host: backend\.example\.test/);
  assert.match(text, /url: https:\/\/backend\.example\.test\/events/);
  assert.match(text, /retryable: yes/);
  assert.match(text, /uplayground-events doctor/);
});

test("formatCliError keeps plain errors to a single line", () => {
  const text = formatCliError(new Error("Usage: eventchat-events get <event-id>"));
  assert.equal(text, "Usage: eventchat-events get <event-id>");
});

test("help text documents the mcp, serve, and install commands", () => {
  const text = helpText();
  assert.match(text, /\binstall\b/);
  assert.match(text, /\bmcp\b/);
  assert.match(text, /\bserve\b/);
  assert.match(text, /npx -y uplayground-events mcp/);
});

test("install with an unknown target exits 1 with the overview", async () => {
  const io = fakeIo();
  const code = await runCli(["install", "emacs"], io);
  assert.equal(code, 1);
  assert.match(io.stderrText(), /Unknown install target: emacs/);
  assert.match(io.stderrText(), /claude-desktop/);
});
