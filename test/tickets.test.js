import assert from "node:assert/strict";
import test, { beforeEach } from "node:test";
import { clearEventCache } from "../src/api.js";
import { ToolInputError } from "../src/errors.js";
import {
  TICKET_PURCHASE_POLICY,
  buildTicketOffers,
  decodeQuoteToken,
  encodeQuoteToken,
  quoteTicketOrder,
  validatePurchaseConfirmation
} from "../src/tickets.js";
import { callTool } from "../src/tools.js";

beforeEach(() => clearEventCache());

const SECRET = "test-quote-secret";
const QUOTE = {
  quote_id: "quote_abc123",
  quantity: 2,
  max_total: 120,
  purchase_mode: "external_checkout",
  event: { id: "evt-1", title: "Loone with Gegen" }
};

function paidEvent(overrides = {}) {
  return {
    id: "evt-paid",
    title: "Klubnacht",
    start_time: "2026-09-12T21:00:00Z",
    end_time: "2026-09-13T06:00:00Z",
    venue_name: "Berghain",
    venue_address: "Am Wriezener Bahnhof, 10243 Berlin",
    venue_city: "berlin",
    price_min: 20,
    price_max: 20,
    currency: "EUR",
    ticket_url: "https://ra.co/events/1",
    lineup: ["Ben Klock"],
    genres: ["techno"],
    vibe: ["underground"],
    event_types: ["party"],
    ...overrides
  };
}

function body(result) {
  return JSON.parse(result.content[0].text);
}

function unfold(ics) {
  return ics.replace(/\r\n /g, "");
}

function forge(token, edit) {
  const [payload, signature] = token.split(".");
  const quote = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  edit(quote);
  return `${Buffer.from(JSON.stringify(quote), "utf8").toString("base64url")}.${signature}`;
}

function isInvalidToken(error) {
  return error instanceof ToolInputError
    && error.code === "invalid_quote_token"
    && error.field === "quote_token";
}

// ---------------------------------------------------------------------------
// Signed quote tokens
// ---------------------------------------------------------------------------

test("quote tokens round-trip and are payload.signature", () => {
  const token = encodeQuoteToken(QUOTE, SECRET);
  assert.equal(token.split(".").length, 2, "exactly one dot");
  assert.match(token, /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/);
  assert.deepEqual(decodeQuoteToken(token, SECRET), QUOTE);
});

test("a tampered payload is rejected as invalid_quote_token", () => {
  const forged = forge(encodeQuoteToken(QUOTE, SECRET), (quote) => { quote.max_total = 999999; });
  assert.throws(() => decodeQuoteToken(forged, SECRET), isInvalidToken);
});

test("a token signed with another secret is rejected", () => {
  const token = encodeQuoteToken(QUOTE, "other-secret");
  assert.throws(() => decodeQuoteToken(token, SECRET), isInvalidToken);
});

test("garbage tokens are rejected", () => {
  assert.throws(() => decodeQuoteToken("not-a-token", SECRET), isInvalidToken);
  assert.throws(() => decodeQuoteToken("a.b.c", SECRET), isInvalidToken);
  assert.throws(() => decodeQuoteToken("bm90anNvbg.sig", SECRET), isInvalidToken);
});

test("a missing token is an ordinary invalid_argument", () => {
  for (const missing of [undefined, null, ""]) {
    assert.throws(() => decodeQuoteToken(missing, SECRET), (error) =>
      error instanceof ToolInputError
      && error.message === "quote_token is required."
      && error.code === "invalid_argument"
      && error.field === "quote_token");
  }
});

// ---------------------------------------------------------------------------
// Written confirmation
// ---------------------------------------------------------------------------

test("confirmation matches whole words and whole numbers", () => {
  const quote = { quantity: 2, max_total: 120 };

  assert.deepEqual(validatePurchaseConfirmation(quote, "Yes, buy 2 tickets max total 120"), { valid: true, missing: [] });
  assert.deepEqual(validatePurchaseConfirmation(quote, "purchase 2 for EUR120.00"), { valid: true, missing: [] });
  assert.deepEqual(validatePurchaseConfirmation(quote, "book 2 tickets, max total €120"), { valid: true, missing: [] });

  const buyer = validatePurchaseConfirmation(quote, "I am the buyer, 20 people, 120 dollars");
  assert.equal(buyer.valid, false);
  assert.deepEqual(buyer.missing, ["the word buy or purchase", "the quantity 2"]);
  assert.equal(buyer.error, "Written confirmation must include the word buy or purchase, the quantity 2.");

  const inflated = validatePurchaseConfirmation(quote, "buy 21 tickets at 1200");
  assert.equal(inflated.valid, false);
  assert.deepEqual(inflated.missing, ["the quantity 2", "the max total 120"]);
});

test("confirmation does not accept 10 for 1 or 2400 for 24", () => {
  const one = validatePurchaseConfirmation({ quantity: 1, max_total: 120 }, "buy 10 tickets max total 120");
  assert.equal(one.valid, false);
  assert.deepEqual(one.missing, ["the quantity 1"]);

  const twentyFour = validatePurchaseConfirmation({ quantity: 2, max_total: 24 }, "buy 2 tickets for 2400");
  assert.equal(twentyFour.valid, false);
  assert.deepEqual(twentyFour.missing, ["the max total 24"]);
});

test("confirmation without a max_total only needs the verb and quantity", () => {
  assert.deepEqual(validatePurchaseConfirmation({ quantity: 3, max_total: null }, "order 3 please"), { valid: true, missing: [] });
});

// ---------------------------------------------------------------------------
// quoteTicketOrder
// ---------------------------------------------------------------------------

test("quoteTicketOrder rejects bad quantities and accepts a numeric string", () => {
  for (const quantity of [0, 13, 1.5, "abc"]) {
    assert.throws(() => quoteTicketOrder(paidEvent(), { quantity }, { quoteSigningSecret: SECRET }), (error) =>
      error instanceof ToolInputError && error.field === "quantity" && /1 to 12/.test(error.message), `quantity ${quantity}`);
  }
  const quoted = quoteTicketOrder(paidEvent(), { quantity: "2" }, { quoteSigningSecret: SECRET });
  assert.equal(quoted.quoted, true);
  assert.equal(quoted.quote.quantity, 2);
  assert.equal(quoteTicketOrder(paidEvent(), {}, { quoteSigningSecret: SECRET }).quote.quantity, 1, "quantity defaults to 1");
});

test("quoteTicketOrder rejects a negative max_total", () => {
  assert.throws(() => quoteTicketOrder(paidEvent(), { max_total: -5 }, { quoteSigningSecret: SECRET }), (error) =>
    error instanceof ToolInputError && error.field === "max_total" && error.message === "max_total must be a non-negative number.");
});

test("a free event with a link is a free_entry offer, not a purchase", () => {
  const free = paidEvent({ id: "evt-free", price_min: 0, price_max: null });
  const offers = buildTicketOffers(free);
  assert.equal(offers.count, 1);
  assert.equal(offers.offers[0].free_entry, true);
  assert.equal(offers.offers[0].availability_status, "free_entry");
  assert.equal(offers.offers[0].purchase_mode, "external_checkout");
  assert.equal(offers.offers[0].estimated_price, "free");
  assert.match(offers.assistant_instruction, /RSVP/);

  const quoted = quoteTicketOrder(free, { quantity: 1 }, { quoteSigningSecret: SECRET });
  assert.equal(quoted.quoted, true);
  assert.equal(quoted.quote.free_entry, true);
  assert.equal(quoted.quote.availability_status, "free_entry");
});

test("an event without a ticket link has no offer to quote", () => {
  const result = quoteTicketOrder(paidEvent({ ticket_url: null }), { quantity: 1 }, { quoteSigningSecret: SECRET });
  assert.equal(result.quoted, false);
  assert.equal(result.code, "no_offer");
  assert.equal(result.error, "No ticket offer is available for this event.");
  assert.equal(buildTicketOffers(paidEvent({ ticket_url: null })).count, 0);
});

test("a wrong offer_id is unknown_offer", () => {
  const result = quoteTicketOrder(paidEvent(), { offer_id: "offer_doesnotexist" }, { quoteSigningSecret: SECRET });
  assert.equal(result.quoted, false);
  assert.equal(result.code, "unknown_offer");
  assert.match(result.error, /offer_id does not match/);

  const offerId = buildTicketOffers(paidEvent()).offers[0].offer_id;
  assert.equal(quoteTicketOrder(paidEvent(), { offer_id: offerId }, { quoteSigningSecret: SECRET }).quoted, true);
});

test("quotes expire ten minutes after options.now", () => {
  const now = new Date("2026-09-08T12:00:00Z");
  const quoted = quoteTicketOrder(paidEvent(), { quantity: 2, max_total: 120 }, { quoteSigningSecret: SECRET, now });
  assert.equal(quoted.quote.expires_at, "2026-09-08T12:10:00.000Z");
  assert.equal(quoted.confirmation_required, true);
  assert.match(quoted.confirmation_prompt, /buy 2 ticket\(s\) for Klubnacht, max total EUR120/);
});

// ---------------------------------------------------------------------------
// purchaseTicketOrder end-to-end through callTool
// ---------------------------------------------------------------------------

const NOW = new Date("2026-09-08T12:00:00Z");

function ticketOptions(event, extra = {}) {
  return {
    config: { apiBaseUrl: "https://api.example.test", userAgent: "test" },
    now: NOW,
    quoteSigningSecret: SECRET,
    fetch: async (url) => {
      const path = new URL(url).pathname;
      if (path === `/events/${encodeURIComponent(event.id)}`) return Response.json(event);
      return new Response("not found", { status: 404 });
    },
    ...extra
  };
}

async function quoteThroughTool(event, options, input = {}) {
  const quoted = await callTool("dizko_quote_tickets", { event_id: event.id, quantity: 2, max_total: 120, ...input }, options);
  assert.equal(quoted.isError, false, quoted.content[0].text);
  const result = body(quoted);
  assert.equal(result.quoted, true);
  return result;
}

test("external checkout: purchase hands off with checkout_url and a tentative calendar entry", async () => {
  const event = paidEvent({ id: "evt-external" });
  const options = ticketOptions(event);
  const quoted = await quoteThroughTool(event, options);
  assert.equal(quoted.quote.purchase_mode, "external_checkout");
  assert.equal(quoted.quote.quantity, 2);
  assert.equal(quoted.quote.max_total, 120);

  const purchased = await callTool("dizko_purchase_tickets", {
    quote_token: quoted.quote_token,
    confirmation_text: "Yes, buy 2 tickets max total 120"
  }, options);
  assert.equal(purchased.isError, false, purchased.content[0].text);
  const result = body(purchased);
  assert.equal(result.purchased, false);
  assert.equal(result.status, "requires_external_checkout");
  assert.equal(result.checkout_url, "https://ra.co/events/1");
  assert.equal(result.ticket_delivery_status, "external_checkout_controls_delivery");
  assert.equal(result.calendar_event.status, "TENTATIVE");
  assert.equal(result.calendar_event.title, "Klubnacht");
  assert.match(result.calendar_event.ics_content, /BEGIN:VEVENT/);
  assert.match(result.calendar_event.ics_content, /STATUS:TENTATIVE/);
  assert.match(result.assistant_instruction, /do not claim the agent bought the ticket/);
});

test("a confirmation that does not match the quote is confirmation_mismatch", async () => {
  const event = paidEvent({ id: "evt-mismatch" });
  const options = ticketOptions(event);
  const quoted = await quoteThroughTool(event, options);

  const purchased = await callTool("dizko_purchase_tickets", {
    quote_token: quoted.quote_token,
    confirmation_text: "I am the buyer, 20 people, 120 dollars"
  }, options);
  const result = body(purchased);
  assert.equal(result.purchased, false);
  assert.equal(result.status, "confirmation_required");
  assert.equal(result.code, "confirmation_mismatch");
  assert.deepEqual(result.missing, ["the word buy or purchase", "the quantity 2"]);
});

test("an expired quote is refused before any handoff", async () => {
  const event = paidEvent({ id: "evt-expired" });
  const options = ticketOptions(event);
  const quoted = await quoteThroughTool(event, options);

  const later = { ...options, now: new Date(NOW.getTime() + 11 * 60 * 1000) };
  const purchased = await callTool("dizko_purchase_tickets", {
    quote_token: quoted.quote_token,
    confirmation_text: "Yes, buy 2 tickets max total 120"
  }, later);
  const result = body(purchased);
  assert.equal(result.purchased, false);
  assert.equal(result.status, "quote_expired");
  assert.equal(result.code, "quote_expired");
  assert.equal(result.checkout_url, undefined);
});

test("a tampered token is rejected through the tool with invalid_quote_token", async () => {
  const event = paidEvent({ id: "evt-tamper" });
  const options = ticketOptions(event);
  const quoted = await quoteThroughTool(event, options);
  const forged = forge(quoted.quote_token, (quote) => {
    quote.quantity = 12;
    quote.max_total = 999999;
    quote.purchase_mode = "partner_api_purchase";
  });

  const purchased = await callTool("dizko_purchase_tickets", {
    quote_token: forged,
    confirmation_text: "Yes, buy 12 tickets max total 999999"
  }, options);
  assert.equal(purchased.isError, true);
  const result = body(purchased);
  assert.equal(result.code, "invalid_quote_token");
  assert.equal(result.field, "quote_token");
  assert.match(result.error, /invalid, altered/);
});

test("an integrated provider completes the purchase and the calendar entry carries the order", async () => {
  const event = paidEvent({ id: "evt-provider" });
  const calls = [];
  const provider = {
    canPurchase: () => true,
    purchase: async (request) => {
      calls.push(request);
      return { purchased: true, status: "purchased", order_id: "o1" };
    }
  };
  const options = ticketOptions(event, { ticketPurchaseProvider: provider });
  const quoted = await quoteThroughTool(event, options);
  assert.equal(quoted.quote.purchase_mode, "partner_api_purchase");
  assert.equal(quoted.quote.autonomous_purchase_supported, true);

  const purchased = await callTool("dizko_purchase_tickets", {
    quote_token: quoted.quote_token,
    confirmation_text: "Yes, buy 2 tickets max total 120"
  }, options);
  assert.equal(purchased.isError, false, purchased.content[0].text);
  const result = body(purchased);
  assert.equal(result.purchased, true);
  assert.equal(result.status, "purchased");
  assert.equal(result.order_id, "o1");
  assert.equal(result.calendar_event.status, "CONFIRMED");
  assert.match(unfold(result.calendar_event.ics_content), /\\nOrder: o1(\\n|\r\n)/);

  assert.equal(calls.length, 1);
  assert.equal(calls[0].quote.quantity, 2);
  assert.equal(calls[0].quote.max_total, 120);
  assert.equal(calls[0].confirmation_text, "Yes, buy 2 tickets max total 120");
  assert.equal(calls[0].idempotency_key, quoted.quote.quote_id);
});

test("a provider failure is reported with a sanitized error", async () => {
  const event = paidEvent({ id: "evt-declined" });
  const provider = {
    canPurchase: () => true,
    purchase: async () => ({ purchased: false, error: "card 4242 declined by acquirer 10.0.0.1" })
  };
  const options = ticketOptions(event, { ticketPurchaseProvider: provider });
  const quoted = await quoteThroughTool(event, options);

  const purchased = await callTool("dizko_purchase_tickets", {
    quote_token: quoted.quote_token,
    confirmation_text: "Yes, buy 2 tickets max total 120"
  }, options);
  const result = body(purchased);
  assert.equal(result.purchased, false);
  assert.equal(result.status, "purchase_failed");
  assert.equal(result.code, "purchase_failed");
  assert.equal(result.error, "Ticket purchase could not be completed.");
  assert.ok(!JSON.stringify(result).includes("4242"), "provider error text never reaches the model");
});

test("a partner quote without a configured provider cannot be purchased", async () => {
  const event = paidEvent({ id: "evt-noprovider" });
  const quoteOptions = ticketOptions(event, { ticketPurchaseProvider: { canPurchase: () => true } });
  const quoted = await quoteThroughTool(event, quoteOptions);
  assert.equal(quoted.quote.purchase_mode, "partner_api_purchase");

  const purchased = await callTool("dizko_purchase_tickets", {
    quote_token: quoted.quote_token,
    confirmation_text: "Yes, buy 2 tickets max total 120"
  }, quoteOptions);
  const result = body(purchased);
  assert.equal(result.purchased, false);
  assert.equal(result.status, "purchase_provider_not_configured");
  assert.equal(result.code, "purchase_provider_not_configured");
});

// ---------------------------------------------------------------------------
// Policy
// ---------------------------------------------------------------------------

test("TICKET_PURCHASE_POLICY carries the Dizko brand, not the old one", () => {
  assert.ok(TICKET_PURCHASE_POLICY.supported_modes.includes("dizko_checkout"));
  assert.ok(!TICKET_PURCHASE_POLICY.supported_modes.includes("uplayground_checkout"));
  assert.equal(TICKET_PURCHASE_POLICY.autonomous_purchase_available, false);
  assert.ok(!JSON.stringify(TICKET_PURCHASE_POLICY).toLowerCase().includes("uplayground"));
});
