# resend-link-worker

Cloudflare Worker that serves Resend email HTML via JWT-authenticated links.

## How it works

1. A request arrives with a `?token=` query parameter containing a signed JWT
2. The worker verifies the JWT against `RESEND_JWT_SECRET` (HS256)
3. Extracts the `email_id` claim from the token payload
4. Fetches the email HTML from the Resend API
5. Returns the HTML with `Cache-Control` headers derived from the token's expiry
6. Caches the response via the Cloudflare Cache API to avoid redundant Resend calls

## Environment variables

| Variable | Description |
| --- | --- |
| `RESEND_API_KEY` | Resend API key |
| `RESEND_JWT_SECRET` | Shared secret used to sign/verify JWTs |

Set these as secrets in the Cloudflare dashboard or via `wrangler secret put`.

## Setup

```sh
bun install
```

## Local development

```sh
bun run dev
```

## Generate a test token

```sh
bun run generate-jwt -- --secret "your-jwt-secret" --email-id "email-abc123" --expires-in 900
```

## Deploy

```sh
bun run deploy
```

## Regenerate Cloudflare types

```sh
bun run cf-typegen
```

This writes `worker-configuration.d.ts` (git-ignored).

## Lint & format

```sh
bun run lint      # check
bun run format    # auto-fix
```

## Type check

```sh
bun run typecheck
```

## Tests

Tests use `@cloudflare/vitest-pool-workers` to run inside the Workers runtime.

```sh
bun run test
```
