import { Buffer } from "node:buffer";

export const CONNECTOR_CONTRACT_VERSION = "2026-09-19";

export function encodeEventCursor(offset) {
  return Buffer.from(JSON.stringify({ v: 1, offset }), "utf8").toString("base64url");
}

export function decodeEventCursor(cursor) {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(String(cursor), "base64url").toString("utf8"));
    if (value?.v !== 1 || !Number.isInteger(value.offset) || value.offset < 0 || value.offset > 10_000) throw new Error();
    return value.offset;
  } catch {
    const error = new Error("Invalid cursor. Use next_cursor returned by search_events.");
    error.code = "invalid_cursor";
    throw error;
  }
}

export function connectorPage({ events, total, limit, offset }) {
  const nextOffset = offset + events.length;
  return {
    contract_version: CONNECTOR_CONTRACT_VERSION,
    count: total,
    page: {
      limit,
      returned: events.length,
      next_cursor: nextOffset < total && events.length > 0 ? encodeEventCursor(nextOffset) : null
    },
    events
  };
}
