import { createHash } from "node:crypto";
import { buildCalendarEvent } from "./calendar.js";
import { summarizeEvent } from "./format.js";

const DEFAULT_QUOTE_TTL_MS = 10 * 60 * 1000;

export const TICKET_PURCHASE_POLICY = {
  autonomous_purchase_available: false,
  supported_modes: [
    "external_checkout",
    "partner_api_purchase",
    "uplayground_checkout",
    "delegated_payment_future"
  ],
  provider_contract: "Hermes, OpenClaw, Dizko Checkout, or another purchase provider can implement ticketPurchaseProvider.purchase({ quote, confirmation_text, delivery_email, add_to_calendar }) to enable bounded autonomous purchase, ticket email delivery, and calendar attachment/creation.",
  hard_rules: [
    "Never purchase from a third-party ticket site by browser automation, scraping, CAPTCHA bypass, or stored raw card details.",
    "Create a locked quote before purchase.",
    "Require explicit written confirmation in the conversation before purchase.",
    "Stop and ask again if event, date, venue, quantity, ticket type, fees, refund terms, or total price changes.",
    "Respect user max_total, quantity, age restriction, accessibility, refund constraints, ticket delivery email, and calendar preference."
  ],
  current_default_behavior: "If an event only has a third-party ticket URL, return a checkout handoff URL instead of claiming the agent purchased the ticket."
};

export function buildTicketOffers(event, options = {}) {
  const summary = summarizeEvent(event, options);
  const provider = normalizeProvider(summary.source, summary.ticket_url);
  const hasCheckout = Boolean(summary.ticket_url);
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
    availability_status: hasCheckout || autonomousSupported ? "checkout_available" : "unknown",
    ticket_url: summary.ticket_url,
    estimated_price: summary.price,
    currency: event.currency || inferCurrency(summary.price),
    price_guaranteed: false,
    fees_included: false,
    notes: offerNotes({ hasCheckout, autonomousSupported, provider })
  };

  return {
    event: summary,
    count: purchaseMode === "unavailable" ? 0 : 1,
    offers: purchaseMode === "unavailable" ? [] : [offer],
    policy: TICKET_PURCHASE_POLICY,
    assistant_instruction: purchaseMode === "unavailable"
      ? "Tell the user ticket inventory is not available through Dizko for this event yet."
      : "Show ticket options, explain whether autonomous purchase is supported, and call quote_ticket_order only after the user chooses quantity and constraints."
  };
}

export function quoteTicketOrder(event, input = {}, options = {}) {
  const offersResult = buildTicketOffers(event, options);
  const offer = chooseOffer(offersResult.offers, input.offer_id);
  if (!offer) {
    return {
      quoted: false,
      error: "No ticket offer is available for this event.",
      event: offersResult.event,
      policy: TICKET_PURCHASE_POLICY
    };
  }

  const quantity = normalizeQuantity(input.quantity);
  const now = options.now || new Date();
  const expiresAt = new Date(now.getTime() + DEFAULT_QUOTE_TTL_MS).toISOString();
  const quote = {
    quote_id: quoteId(offer, input, quantity, expiresAt),
    event: offer.event,
    offer_id: offer.offer_id,
    provider: offer.provider,
    purchase_mode: offer.purchase_mode,
    autonomous_purchase_supported: offer.autonomous_purchase_supported,
    availability_status: offer.availability_status,
    checkout_url: offer.ticket_url,
    quantity,
    ticket_type: input.ticket_type || "best available / general admission",
    max_total: input.max_total ?? null,
    currency: input.currency || offer.currency || null,
    estimated_price: offer.estimated_price,
    price_guaranteed: offer.price_guaranteed,
    fees_included: offer.fees_included,
    refund_terms: input.refund_terms || "unknown until checkout/provider quote",
    delivery_email: input.delivery_email || null,
    add_to_calendar: input.add_to_calendar !== false,
    expires_at: expiresAt,
    stop_conditions: [
      "price exceeds max_total",
      "event title, date, venue, or city changes",
      "requested ticket type or quantity is unavailable",
      "refund or transfer terms are worse than the user accepted",
      "checkout requires credentials, CAPTCHA, age verification, or payment details not available to the provider"
    ]
  };

  return {
    quoted: true,
    quote,
    quote_token: encodeQuoteToken(quote),
    confirmation_required: true,
    confirmation_prompt: confirmationPrompt(quote),
    assistant_instruction: "Ask the user for explicit written confirmation matching this quote before calling purchase_ticket_order. If purchase_mode is external_checkout, the next tool call will return a checkout handoff rather than an autonomous purchase."
  };
}

export async function purchaseTicketOrder(input = {}, options = {}) {
  const quote = decodeQuoteToken(input.quote_token);
  const confirmation = validatePurchaseConfirmation(quote, input.confirmation_text);
  if (!confirmation.valid) {
    return {
      purchased: false,
      status: "confirmation_required",
      error: confirmation.error,
      quote,
      confirmation_prompt: confirmationPrompt(quote)
    };
  }

  if (new Date(quote.expires_at).getTime() < (options.now || new Date()).getTime()) {
    return {
      purchased: false,
      status: "quote_expired",
      quote,
      assistant_instruction: "Tell the user the ticket quote expired and call quote_ticket_order again before any purchase."
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

  const provider = options.ticketPurchaseProvider;
  if (!provider?.purchase) {
    return {
      purchased: false,
      status: "purchase_provider_not_configured",
      quote,
      assistant_instruction: "Tell the user autonomous purchase is not enabled for this provider yet. Offer checkout handoff or ask them to choose another event with integrated checkout."
    };
  }

  const result = await provider.purchase({
    quote,
    confirmation_text: input.confirmation_text,
    delivery_email: input.delivery_email || quote.delivery_email || null,
    add_to_calendar: input.add_to_calendar ?? quote.add_to_calendar ?? true,
    user_payment_profile_id: input.user_payment_profile_id || null,
    idempotency_key: input.idempotency_key || quote.quote_id
  });

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
    quote,
    provider_response: result.provider_response || null
  };
}

export function encodeQuoteToken(quote) {
  return Buffer.from(JSON.stringify(quote), "utf8").toString("base64url");
}

export function decodeQuoteToken(token) {
  if (!token || typeof token !== "string") throw new Error("quote_token is required.");
  try {
    return JSON.parse(Buffer.from(token, "base64url").toString("utf8"));
  } catch {
    throw new Error("Invalid quote_token.");
  }
}

function chooseOffer(offers, offerIdInput) {
  if (!offers.length) return null;
  if (!offerIdInput) return offers[0];
  return offers.find((offer) => offer.offer_id === offerIdInput) || null;
}

function normalizeQuantity(quantity) {
  const value = Number(quantity ?? 1);
  if (!Number.isInteger(value) || value < 1 || value > 12) {
    throw new Error("quantity must be an integer between 1 and 12.");
  }
  return value;
}

function validatePurchaseConfirmation(quote, confirmationText) {
  const text = String(confirmationText || "").toLowerCase();
  if (!text.includes("buy") && !text.includes("purchase")) {
    return { valid: false, error: "Written confirmation must explicitly say buy or purchase." };
  }
  if (!text.includes(String(quote.quantity))) {
    return { valid: false, error: `Written confirmation must include the quantity ${quote.quantity}.` };
  }
  if (quote.max_total != null && !text.includes(String(quote.max_total))) {
    return { valid: false, error: `Written confirmation must include the max total ${quote.max_total}.` };
  }
  return { valid: true };
}

function confirmationPrompt(quote) {
  const maxTotal = quote.max_total == null ? "the provider's checkout price" : `${quote.currency || ""}${quote.max_total}`;
  return `To authorize, write: "Yes, buy ${quote.quantity} ticket(s) for ${quote.event.title}, max total ${maxTotal}. Stop if price, date, venue, ticket type, quantity, or refund terms change."`;
}

function normalizeProvider(source, ticketUrl) {
  const value = `${source || ""} ${ticketUrl || ""}`.toLowerCase();
  if (value.includes("ticketmaster")) return "ticketmaster";
  if (value.includes("eventbrite")) return "eventbrite";
  if (value.includes("resident") || value.includes("ra.co")) return "resident_advisor";
  if (value.includes("partiful")) return "partiful";
  if (value.includes("dola")) return "dola";
  if (value.includes("hermes")) return "hermes";
  if (value.includes("openclaw")) return "openclaw";
  return source || "unknown";
}

function offerNotes({ hasCheckout, autonomousSupported, provider }) {
  if (autonomousSupported) {
    return [`${provider} can support bounded autonomous purchase through an integrated provider.`];
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
  return createHash("sha256").update(String(value)).digest("hex");
}

function inferCurrency(price) {
  if (!price) return null;
  if (String(price).startsWith("USD")) return "USD";
  if (String(price).startsWith("$")) return "USD";
  if (String(price).startsWith("€")) return "EUR";
  if (String(price).startsWith("£")) return "GBP";
  return null;
}
