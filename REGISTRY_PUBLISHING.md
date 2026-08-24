# MCP Registry publishing

The registry name is `app.dizko/events`. The npm package proves ownership with
the matching `mcpName` field, and DNS authentication proves control of
`dizko.app` without committing a private key.

## DNS preparation

Generate a dedicated Ed25519 key locally:

```sh
openssl genpkey -algorithm Ed25519 -out dizko-mcp-registry.pem
openssl pkey -in dizko-mcp-registry.pem -pubout -outform DER \
  | tail -c 32 | base64
```

Publish the output as the public key in this TXT record:

```text
_mcp-verify.dizko.app TXT "v=MCPv1; k=ed25519; p=<BASE64_PUBLIC_KEY>"
```

Keep `dizko-mcp-registry.pem` outside this repository. After DNS resolves and
the exact version in `server.json` exists on npm, authenticate and publish:

```sh
mcp-publisher login dns --domain=dizko.app --private-key=/absolute/path/dizko-mcp-registry.pem
mcp-publisher validate
mcp-publisher publish
```

Never commit the private key or paste it into a CI log.
