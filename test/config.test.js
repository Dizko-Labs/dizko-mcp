import assert from "node:assert/strict";
import test from "node:test";
import {
  DEFAULT_API_BASE_URL,
  DEFAULT_MCP_URL,
  DEFAULT_WEB_BASE_URL,
  TOOL_VERSION,
  getConfig
} from "../src/config.js";

test("getConfig returns shared defaults for every surface", () => {
  const config = getConfig({});
  assert.equal(config.apiBaseUrl, DEFAULT_API_BASE_URL);
  assert.equal(config.webBaseUrl, DEFAULT_WEB_BASE_URL);
  assert.equal(config.mcpUrl, DEFAULT_MCP_URL);
  assert.equal(config.apiTimeoutMs, 8000);
  assert.equal(config.apiRetries, 2);
  assert.equal(config.apiRetryBaseDelayMs, 250);
  assert.equal(config.userAgent, `EventChatEventsTool/${TOOL_VERSION}`);
});

test("getConfig honors EVENTCHAT_* env overrides and trims trailing slashes", () => {
  const config = getConfig({
    EVENTCHAT_API_BASE_URL: "https://api.example.test///",
    EVENTCHAT_WEB_BASE_URL: "https://web.example.test/",
    EVENTCHAT_MCP_URL: "https://mcp.example.test/mcp/",
    EVENTCHAT_API_TIMEOUT_MS: "1234",
    EVENTCHAT_API_RETRIES: "5",
    EVENTCHAT_API_RETRY_BASE_DELAY_MS: "10"
  });
  assert.equal(config.apiBaseUrl, "https://api.example.test");
  assert.equal(config.webBaseUrl, "https://web.example.test");
  assert.equal(config.mcpUrl, "https://mcp.example.test/mcp");
  assert.equal(config.apiTimeoutMs, 1234);
  assert.equal(config.apiRetries, 5);
  assert.equal(config.apiRetryBaseDelayMs, 10);
});

test("getConfig accepts UPLAYGROUND_* aliases with EVENTCHAT_* taking precedence", () => {
  const aliased = getConfig({
    UPLAYGROUND_API_BASE_URL: "https://alias-api.example.test",
    UPLAYGROUND_MCP_URL: "https://alias-mcp.example.test/mcp"
  });
  assert.equal(aliased.apiBaseUrl, "https://alias-api.example.test");
  assert.equal(aliased.mcpUrl, "https://alias-mcp.example.test/mcp");

  const both = getConfig({
    EVENTCHAT_API_BASE_URL: "https://canonical.example.test",
    UPLAYGROUND_API_BASE_URL: "https://alias-api.example.test"
  });
  assert.equal(both.apiBaseUrl, "https://canonical.example.test");
});

test("getConfig falls back to defaults for invalid numeric env values", () => {
  const config = getConfig({
    EVENTCHAT_API_TIMEOUT_MS: "not-a-number",
    EVENTCHAT_API_RETRIES: "-3",
    EVENTCHAT_API_RETRY_BASE_DELAY_MS: "0"
  });
  assert.equal(config.apiTimeoutMs, 8000);
  assert.equal(config.apiRetries, 2);
  assert.equal(config.apiRetryBaseDelayMs, 250);
});

test("getConfig allows zero retries", () => {
  assert.equal(getConfig({ EVENTCHAT_API_RETRIES: "0" }).apiRetries, 0);
});

test("getConfig exposes cache TTL and stale-window settings with env overrides", () => {
  const defaults = getConfig({});
  assert.equal(defaults.apiCacheTtlMs, 300_000);
  assert.equal(defaults.apiCacheStaleMs, 3_600_000);

  const overridden = getConfig({ EVENTCHAT_API_CACHE_TTL_MS: "0", EVENTCHAT_API_CACHE_STALE_MS: "60000" });
  assert.equal(overridden.apiCacheTtlMs, 0, "0 must be honored to disable caching");
  assert.equal(overridden.apiCacheStaleMs, 60_000);
});
