import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { buildCalendarEvent } from "./calendar.js";
import { ToolInputError } from "./errors.js";
import { summarizeEvent } from "./format.js";

const DEFAULT_QUOTE_TTL_MS = 10 * 60 * 1000;
const STOP_CONDITIONS = [
  "price exceeds max_total",
  "event title, date, venue, or city changes",
  "requested ticket type or quantity is unavailable",
  "refund or transfer terms are worse than the user accepted",
  "checkout requires credentials, CAPTCHA, age verification, or payment details not available to the provider"
];
const MAX_QUANTITY = 12;

// Quote tokens are signed so a caller cannot edit quantity, max_total,
// purchase mode or checkout URL between quote and purchase. Set
// DIZKO_QUOTE_SIGNING_SECRET so tokens survive restarts and replicas; the
// per-process fallback is only safe for a single instance.
const processSecret = randomBytes(32).toString("base64url");

export function quoteSigningSecret(options = {}) {
  const env = options.env || process.env;
  return options.quoteSigningSecret || env.DIZKO_QUOTE_SIGNING_SECRET || env.EVENTCHAT_QUOTE_SIGNING_SECRET || processSecret;
}

export const TICKET_PURCHASE_POLICY = {
  autonomous_purchase_available: false,
  supported_modes: [
    "external_checkout",
    "partner_api_purchase",
    "dizko_checkout",
    "delegated_payment_future"
  ],
  provider_contract: "Hermes, OpenClaw, Dizko Checkout, or another purchase provider can implement ticketPurchaseProvider.purchase({ quote, confirmation_text, delivery_email, add_to_calendar }) to enable bounded autonomous purchase, ticket email delivery, and calendar attachment/creation.",
  hard_rules: [
    "Never purchase from a third-party ticket site by browser automation, scraping, CAPTCHA bypass, or stored raw card details.",
    "Create a locked, signed quote before purchase.",
    "Require explicit written confirmation in the conversation before purchase.",
    "Stop and ask again if event, date, venue, quantity, ticket type, fees, refund terms, or total price changes.",
    "Respect user max_total, quantity, age restriction, accessibility, refund constraints, ticket delivery email, and calendar preference."
  ],
  current_default_behavior: "If an event only has a third-party ticket URL, return a checkout handoff URL instead of claiming the agent purchased the ticket."
};

export function buildTicketOffers(event, options = {}) {
  const summary = summarizeEvent(event, options);
  const provider = normalizeProvider(event.source_display || event.source, summary.ticket_url);
  const hasCheckout = Boolean(summary.ticket_url);
  const freeEntry = summary.price === "free";
  const purchaseProvider = options.ticketPurchaseProvider;
  const autonomousSupported = Boolean(purchaseProvider?.canPurchase?.(event, summary));
  const purchaseMode = autonomousSupported
    ? "partner_api_purchase"
    : hasCheckout
      ? "external_checkout"
      : "unavailable";

  const offer = {
    offer_id: offerId(summary),
    event: summary,
    provider,
    purchase_mode: purchaseMode,
    autonomous_purchase_supported: autonomousSupported,
    availability_status: hasCheckout || autonomousSupported ? (freeEntry ? "free_entry" : "checkout_available") : "unknown",
    free_entry: freeEntry,
    ticket_url: summary.ticket_url,
    estimated_price: summary.price,
    currency: event.currency || inferCurrency(summary.price),
    price_guaranteed: false,
    fees_included: false,
    notes: offerNotes({ hasCheckout, autonomousSupported, provider, freeEntry })
  };

  return {
    event: summary,
    count: purchaseMode === "unavailable" ? 0 : 1,
    offers: purchaseMode === "unavailable" ? [] : [offer],
    policy: TICKET_PURCHASE_POLICY,
    assistant_instruction: purchaseMode === "unavailable"
      ? "Tell the user ticket inventory is not available through Dizko for this event yet."
      : freeEntry
        ? "This event is free entry. Share the link for RSVP or guest list; no quote or purchase is needed unless the link sells add-ons."
        : "Show ticket options, explain whether autonomous purchase is supported, and call dizko_quote_tickets only after the user chooses quantity and constraints."
  };
}

export function quoteTicketOrder(event, input = {}, options = {}) {
  const quantity = normalizeQuantity(input.quantity);
  const maxTotal = normalizeMoney(input.max_total, "max_total");
  const offersResult = buildTicketOffers(event, options);
  const offer = chooseOffer(offersResult.offers, input.offer_id);
  if (!offer) {
    return {
      quoted: false,
      error: input.offer_id && offersResult.offers.length
        ? "That offer_id does not match this event. Call dizko_ticket_offers again and use the returned offer_id."
        : "No ticket offer is available for this event.",
      code: input.offer_id && offersResult.offers.length ? "unknown_offer" : "no_offer",
      event: offersResult.event,
      policy: TICKET_PURCHASE_POLICY
    };
  }

  const now = options.now || new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_QUOTE_TTL_MS).toISOString();
  const quote = {
    quote_id: quoteId(offer, input, quantity, expiresAt),
    event: miniEvent(offer.event),
    offer_id: offer.offer_id,
    provider: offer.provider,
    purchase_mode: offer.purchase_mode,
    autonomous_purchase_supported: offer.autonomous_purchase_supported,
    availability_status: offer.availability_status,
    free_entry: offer.free_entry,
    checkout_url: offer.ticket_url,
    quantity,
    ticket_type: input.ticket_type || "best available / general admission",
    max_total: maxTotal,
    currency: input.currency || offer.currency || null,
    estimated_price: offer.estimated_price,
    price_guaranteed: offer.price_guaranteed,
    fees_included: offer.fees_included,
    refund_terms: input.refund_terms || "unknown until checkout/provider quote",
    delivery_email: input.delivery_email || null,
    add_to_calendar: input.add_to_calendar !== false,
    expires_at: expiresAt,
    stop_conditions: STOP_CONDITIONS
  };

  return {
    quoted: true,
    quote,
    quote_token: encodeQuoteToken(quote, quoteSigningSecret(options)),
    confirmation_required: true,
    confirmation_prompt: confirmationPrompt(quote),
    assistant_instruction: "Ask the user for explicit written confirmation matching this quote before calling dizko_purchase_tickets. If purchase_mode is external_checkout, the next call returns a checkout handoff rather than an autonomous purchase."
  };
}

// A signed quote is a bearer token: it stays valid for its whole TTL and
// anything holding a copy can present it again. Signing proves the quote was
// minted here, not that it has never been spent. Every quote is therefore
// claimed exactly once - the claim is taken before the provider is called,
// so two concurrent replays cannot both get through - and released only when
// the provider reports the purchase definitively did not happen.
//
// This registry is per-process, which matches the store behind it: several
// replicas need a shared claim store behind the same interface.
const consumedQuotes = new Map();
const DEFAULT_MAX_TRACKED_QUOTES = 20000;

// Sized for concurrent live quotes, not for total volume: everything expired
// is pruned before this is consulted, so the ceiling is only ever reached by
// that many unexpired claims at once.
export function maxTrackedQuotes() {
  // Floor BEFORE the range check: validating first let "0.5" through as a
  // positive number and then floor to 0, and a ceiling of 0 refuses every
  // purchase on a fresh process.
  const configured = Math.floor(Number(process.env.DIZKO_MAX_TRACKED_QUOTES || DEFAULT_MAX_TRACKED_QUOTES));
  if (!Number.isFinite(configured) || configured <= 0) return DEFAULT_MAX_TRACKED_QUOTES;
  return configured;
}

function claimQuote(quoteId, expiresAt, now) {
  pruneConsumedQuotes(now);
  if (consumedQuotes.has(quoteId)) return "already_claimed";
  // Everything expired is already gone, so anything still here is a LIVE
  // claim. Evicting the oldest to make room would free exactly the claim an
  // attacker wants freed: mint junk quotes until the victim's claim is
  // pushed out, then replay it. A full registry fails closed instead.
  if (consumedQuotes.size >= maxTrackedQuotes()) return "registry_full";
  const expiry = Date.parse(expiresAt);
  consumedQuotes.set(quoteId, Number.isFinite(expiry) ? expiry : now.getTime() + DEFAULT_QUOTE_TTL_MS);
  return "claimed";
}

function releaseQuote(quoteId) {
  consumedQuotes.delete(quoteId);
}

function pruneConsumedQuotes(now) {
  const cutoff = now.getTime();
  for (const [quoteId, expiry] of consumedQuotes) {
    if (expiry <= cutoff) consumedQuotes.delete(quoteId);
  }
}

// Test seam: a suite that mints quotes with a fixed clock would otherwise
// see one run's claims leak into the next.
export function resetConsumedQuotes() {
  consumedQuotes.clear();
}

export async function purchaseTicketOrder(input = {}, options = {}) {
  const quote = decodeQuoteToken(input.quote_token, quoteSigningSecret(options));
  const confirmation = validatePurchaseConfirmation(quote, input.confirmation_text);
  if (!confirmation.valid) {
    return {
      purchased: false,
      status: "confirmation_required",
      code: "confirmation_mismatch",
      error: confirmation.error,
      missing: confirmation.missing,
      quote,
      confirmation_prompt: confirmationPrompt(quote)
    };
  }

  // Inclusive, matching pruneConsumedQuotes: with a strict < the claim is
  // pruned at exactly expires_at while the quote is still spendable, and the
  // same quote buys twice on that millisecond.
  if (new Date(quote.expires_at).getTime() <= (options.now || new Date()).getTime()) {
    return {
      purchased: false,
      status: "quote_expired",
      code: "quote_expired",
      quote,
      assistant_instruction: "Tell the user the ticket quote expired and call dizko_quote_tickets again before any purchase."
    };
  }

  if (quote.purchase_mode === "external_checkout") {
    return {
      purchased: false,
      status: "requires_external_checkout",
      quote,
      checkout_url: quote.checkout_url,
      delivery_email: quote.delivery_email,
      ticket_delivery_status: quote.delivery_email ? "enter_email_at_external_checkout" : "external_checkout_controls_delivery",
      calendar_event: quote.add_to_calendar ? buildCalendarEvent(quote.event, { alreadySummarized: true, status: "TENTATIVE" }) : null,
      assistant_instruction: "Tell the user the event currently uses third-party checkout. Open or share the checkout_url so they can complete payment directly; do not claim the agent bought the ticket."
    };
  }

  const claim = claimQuote(quote.quote_id, quote.expires_at, options.now || new Date());
  if (claim === "already_claimed") {
    return {
      purchased: false,
      status: "quote_already_used",
      code: "quote_already_used",
      quote,
      assistant_instruction: "This quote was already submitted for purchase. Do not retry it. Check the user's existing order first, and only call dizko_quote_tickets for a fresh quote if they confirm nothing was bought."
    };
  }
  if (claim === "registry_full") {
    return {
      purchased: false,
      status: "purchase_unavailable",
      code: "quote_registry_full",
      quote,
      assistant_instruction: "Ticket purchase is temporarily unavailable and nothing was charged. Tell the user to try again shortly or use the checkout link."
    };
  }

  const provider = options.ticketPurchaseProvider;
  if (!provider?.purchase) {
    releaseQuote(quote.quote_id);
    return {
      purchased: false,
      status: "purchase_provider_not_configured",
      code: "purchase_provider_not_configured",
      quote,
      assistant_instruction: "Tell the user autonomous purchase is not enabled for this provider yet. Offer checkout handoff or ask them to choose another event with integrated checkout."
    };
  }

  // The idempotency key is derived from the signed quote, never accepted from
  // the caller: a caller-chosen key lets two different orders collide, or one
  // order be replayed under a fresh key.
  // A provider call that throws says nothing about whether the order landed,
  // so the claim deliberately stands and the caller must re-quote rather than
  // retry blind. What it must NOT do is surface as a generic tool error: the
  // model would read that as "it failed", tell the user nothing was bought,
  // and retry - and the retry returns quote_already_used, which reads as a
  // contradiction. The outcome is unknown, and the payload says exactly that.
  let result;
  try {
    result = await provider.purchase({
      quote,
      confirmation_text: input.confirmation_text,
      delivery_email: input.delivery_email || quote.delivery_email || null,
      add_to_calendar: input.add_to_calendar ?? quote.add_to_calendar ?? true,
      user_payment_profile_id: input.user_payment_profile_id || null,
      idempotency_key: quote.quote_id
    });
  } catch {
    return {
      purchased: false,
      status: "purchase_outcome_unknown",
      code: "purchase_outcome_unknown",
      quote,
      assistant_instruction: "The ticket provider did not answer, so it is not known whether this order went through. Do not retry and do not tell the user it failed. Tell them to check their email and the provider's order page, and only quote again if they confirm nothing was bought."
    };
  }

  if (!result?.purchased) {
    // Only an explicit `purchased: false` is the provider stating nothing
    // happened. undefined or null state nothing at all - a fire-and-forget
    // adapter may have placed the order and simply not said so - so the
    // claim stands and the caller must re-quote rather than retry blind.
    if (result?.purchased === false) releaseQuote(quote.quote_id);
    return {
      purchased: false,
      status: "purchase_failed",
      code: "purchase_failed",
      error: "Ticket purchase could not be completed.",
      quote
    };
  }

  return {
    purchased: Boolean(result.purchased),
    status: result.status || "purchase_attempted",
    order_id: result.order_id || null,
    receipt_url: result.receipt_url || null,
    delivery_email: result.delivery_email || input.delivery_email || quote.delivery_email || null,
    ticket_delivery_status: result.ticket_delivery_status || null,
    calendar_event: result.calendar_event || ((input.add_to_calendar ?? quote.add_to_calendar ?? true)
      ? buildCalendarEvent(quote.event, {
        alreadySummarized: true,
        order_id: result.order_id || null,
        receipt_url: result.receipt_url || null
      })
      : null),
    quote
  };
}

// token = base64url(json) + "." + base64url(hmac-sha256(secret, payload))
export function encodeQuoteToken(quote, secret = quoteSigningSecret()) {
  const { stop_conditions: _constant, ...signed } = quote;
  const payload = Buffer.from(JSON.stringify(signed), "utf8").toString("base64url");
  return `${payload}.${sign(payload, secret)}`;
}

export function decodeQuoteToken(token, secret = quoteSigningSecret()) {
  if (!token || typeof token !== "string") {
    throw new ToolInputError("quote_token is required.", { field: "quote_token", hint: "Call dizko_quote_tickets first and pass its quote_token unchanged." });
  }
  const [payload, signature, ...rest] = token.split(".");
  if (!payload || !signature || rest.length) {
    throw invalidToken();
  }
  const expected = Buffer.from(sign(payload, secret));
  const actual = Buffer.from(signature);
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
    throw invalidToken();
  }
  try {
    const quote = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    if (!quote || typeof quote !== "object" || !quote.quote_id) throw invalidToken();
    return { ...quote, stop_conditions: STOP_CONDITIONS };
  } catch (error) {
    if (error instanceof ToolInputError) throw error;
    throw invalidToken();
  }
}

function invalidToken() {
  return new ToolInputError("quote_token is invalid, altered, or was issued by another server.", {
    field: "quote_token",
    code: "invalid_quote_token",
    hint: "Call dizko_quote_tickets again and pass the returned quote_token exactly as given."
  });
}

function sign(payload, secret) {
  return createHmac("sha256", String(secret)).update(payload).digest("base64url");
}

// Only what checkout, confirmation and the calendar entry need; keeps the
// signed token short.
function miniEvent(summary) {
  const keep = ["id", "title", "when", "starts_at", "ends_at", "starts_at_local", "timezone", "venue", "address", "city", "price", "event_url", "ticket_url", "calendar_url", "directions_url"];
  return Object.fromEntries(keep.filter((key) => summary[key] !== undefined && summary[key] !== null).map((key) => [key, summary[key]]));
}

function chooseOffer(offers, offerIdInput) {
  if (!offers.length) return null;
  if (!offerIdInput) return offers[0];
  return offers.find((offer) => offer.offer_id === offerIdInput) || null;
}

function normalizeQuantity(quantity) {
  const value = quantity === undefined || quantity === null || quantity === "" ? 1 : Number(quantity);
  if (!Number.isInteger(value) || value < 1 || value > MAX_QUANTITY) {
    throw new ToolInputError(`quantity must be a whole number from 1 to ${MAX_QUANTITY}.`, {
      field: "quantity",
      hint: `Received ${JSON.stringify(quantity)}.`
    });
  }
  return value;
}

function normalizeMoney(value, field) {
  if (value === undefined || value === null || value === "") return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new ToolInputError(`${field} must be a non-negative number.`, { field, hint: `Received ${JSON.stringify(value)}.` });
  }
  return number;
}

// Whole-word and whole-number matching: "buyer" is not "buy", "20" is not
// "2", and "2400" is not "24".
export function validatePurchaseConfirmation(quote, confirmationText) {
  const text = String(confirmationText || "").toLowerCase();
  const missing = [];
  if (!/\b(buy|purchase|book|order)\b/.test(text)) missing.push("the word buy or purchase");
  if (!containsNumber(text, quote.quantity)) missing.push(`the quantity ${quote.quantity}`);
  if (quote.max_total != null && !containsNumber(text, quote.max_total)) missing.push(`the max total ${quote.max_total}`);
  if (missing.length) {
    return {
      valid: false,
      missing,
      error: `Written confirmation must include ${missing.join(", ")}.`
    };
  }
  return { valid: true, missing: [] };
}

// The number has to stand on its own: "the 12th" is not a quantity of 12 and
// "2,000" is not a quantity of 2. Grouped thousands and a comma decimal are
// accepted as the same value, because people write totals both ways.
function containsNumber(text, value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return false;
  const forms = new Set([String(number)]);
  if (Number.isInteger(number)) {
    forms.add(`${number}.00`);
    forms.add(`${number}.0`);
    forms.add(number.toLocaleString("en-US"));
  } else {
    forms.add(number.toFixed(2));
    forms.add(number.toFixed(2).replace(".", ","));
    forms.add(String(number).replace(".", ","));
    forms.add(number.toLocaleString("en-US", { minimumFractionDigits: 2 }));
  }
  return [...forms].some((form) => {
    const escaped = form.replace(/[.*+?^${}()|[\]\\]/g, (match) => `\\${match}`);
    // A trailing comma or period only disqualifies the match when digits
    // follow it: "buy 2, max total" is the number 2, "2,000" is not.
    return new RegExp(`(^|[^\\d.,])${escaped}(?!\\d)(?![,.]\\d)(?![a-z])`, "i").test(text);
  });
}

// The sentence this asks for is passed back as `confirmation_text`, which
// the schema caps. A festival billing every artist in the title would push
// the mandated wording past that cap, so the server would reject the exact
// words it just demanded. The title is trimmed to keep the whole sentence
// inside the cap; matching still works because it never required the title.
export const CONFIRMATION_TEXT_MAX_LENGTH = 400;

function confirmationPrompt(quote) {
  const maxTotal = quote.max_total == null ? "the provider's checkout price" : `${quote.currency || ""}${quote.max_total}`;
  const sentence = (title) => `Yes, buy ${quote.quantity} ticket(s) for ${title}, max total ${maxTotal}. Stop if price, date, venue, ticket type, quantity, or refund terms change.`;
  const fullTitle = String(quote.event.title || "");
  const overflow = sentence(fullTitle).length - CONFIRMATION_TEXT_MAX_LENGTH;
  const title = overflow > 0 ? `${fullTitle.slice(0, Math.max(1, fullTitle.length - overflow - 1)).trimEnd()}\u2026` : fullTitle;
  return `To authorize, write: "${sentence(title)}"`;
}

function normalizeProvider(source, ticketUrl) {
  const value = `${source || ""} ${ticketUrl || ""}`.toLowerCase();
  if (value.includes("ticketmaster")) return "ticketmaster";
  if (value.includes("eventbrite")) return "eventbrite";
  if (value.includes("resident") || value.includes("ra.co")) return "resident_advisor";
  if (value.includes("partiful")) return "partiful";
  if (value.includes("dice.fm") || /\bdice\b/.test(value)) return "dice";
  if (value.includes("dola")) return "dola";
  if (value.includes("hermes")) return "hermes";
  if (value.includes("openclaw")) return "openclaw";
  return source || "unknown";
}

function offerNotes({ hasCheckout, autonomousSupported, provider, freeEntry }) {
  if (autonomousSupported) {
    return [`${provider} can support bounded autonomous purchase through an integrated provider.`];
  }
  if (freeEntry && hasCheckout) {
    return ["Free entry. The link is for RSVP, guest list, or details; no purchase is needed."];
  }
  if (hasCheckout) {
    return [
      "Third-party checkout link is available.",
      "Autonomous purchase is not enabled unless Hermes, OpenClaw, Dizko Checkout, or another provider supplies an integrated purchase adapter."
    ];
  }
  return ["No ticket checkout link is currently available for this event."];
}

function offerId(summary) {
  return `offer_${hash(`${summary.id}:${summary.ticket_url || ""}`).slice(0, 16)}`;
}

function quoteId(offer, input, quantity, expiresAt) {
  return `quote_${hash(JSON.stringify({
    event_id: offer.event.id,
    offer_id: offer.offer_id,
    quantity,
    ticket_type: input.ticket_type || null,
    max_total: input.max_total ?? null,
    currency: input.currency || offer.currency || null,
    delivery_email: input.delivery_email || null,
    add_to_calendar: input.add_to_calendar !== false,
    expiresAt
  })).slice(0, 20)}`;
}

function hash(value) {
  return createHmac("sha256", "dizko-quote-id").update(String(value)).digest("hex");
}

function inferCurrency(price) {
  if (!price) return null;
  const text = String(price);
  if (text.startsWith("USD") || text.startsWith("$")) return "USD";
  if (text.startsWith("€") || text.startsWith("EUR")) return "EUR";
  if (text.startsWith("£") || text.startsWith("GBP")) return "GBP";
  if (text.startsWith("¥")) return "JPY";
  return null;
}
