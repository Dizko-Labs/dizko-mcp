import { getConfig } from "./config.js";

export async function verifyConnectorBearer(token, options = {}) {
  const config = { ...getConfig(options.env), ...(options.config || {}) };
  if (!config.introspectionSecret) return null;
  const doFetch = options.fetch || fetch;
  const response = await doFetch(`${config.oauthIssuer}/oauth/introspect`, {
    method: "POST",
    signal: AbortSignal.timeout(config.apiTimeoutMs),
    headers: { Authorization: `Bearer ${config.introspectionSecret}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams({ token })
  });
  if (!response.ok) return null;
  const claims = await response.json();
  if (!claims.active || claims.token_type !== "access" || claims.aud !== config.oauthResource || !claims.sub) return null;
  return { subject: claims.sub, clientId: claims.client_id, scopes: String(claims.scope || "").split(/\s+/).filter(Boolean) };
}
