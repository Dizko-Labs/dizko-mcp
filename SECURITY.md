# Security Policy

## Scope

This policy covers the Dizko Events MCP package, hosted MCP endpoint, preference-memory tools, profile-secret access, public privacy/support pages, event-search/recommendation tools, and ticket quote/purchase handoff tools in this directory.

Production MCP endpoint:

```text
https://mcp.dizko.app/mcp
```

## Reporting A Vulnerability

Email security reports to:

```text
security@urbanplayground.xyz
```

Please include:

- Affected endpoint or tool name.
- Steps to reproduce.
- Expected and actual behavior.
- Whether preference profiles, profile secrets, feedback, or other user data may be involved.
- Any relevant timestamps or request ids, if available.

Do not include another person's profile secret, private notes, or personal data in the report. For ordinary support, deletion, or account/privacy help, use `support@urbanplayground.xyz` or `privacy@urbanplayground.xyz`.

## Operational Safeguards

- Preference profiles require explicit consent before creation or updates.
- Profile access requires both `profile_id` and private `profile_secret`; the service stores only a hash of the secret.
- Deletion is exposed through the destructive `delete_event_preferences` tool and removes saved connector preferences and feedback for the profile only when `confirm_delete: true` is supplied after user confirmation.
- Ticket purchase is exposed through the destructive/open-world `purchase_ticket_order` boundary. It requires a locked quote and explicit written confirmation; third-party-only checkout links must not be represented as completed purchases.
- Public MCP traffic is rate-limited and emits `X-RateLimit-*` headers.
- The hosted endpoint serves restrictive CSP, referrer-policy, and content-type headers.
- Submission verification should be run before public review:

```bash
npm run verify:submission:bundle
npm run verify:submission:fields
```

Operational checks, rollback, and incident response are documented in `OPERATIONS.md`.
