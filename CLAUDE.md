# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Overview

Cloudflare Worker that serves Resend email HTML via JWT-authenticated links. A request arrives with a `?token=` query parameter containing an HS256 JWT. The worker verifies the token, extracts the `email_id` claim, fetches the email HTML from the Resend API, and returns it with cache headers derived from the token's expiry. Responses are cached via the Cloudflare Cache API.

## Commands

```sh
bun install              # install dependencies
bun run dev              # local dev server (wrangler dev)
bun run test             # run tests (vitest via @cloudflare/vitest-pool-workers)
bun run lint             # lint with biome
bun run format           # auto-fix lint/format issues with biome
bun run typecheck        # generate CF types then tsc --noEmit
bun run deploy           # deploy to Cloudflare
bun run cf-typegen       # regenerate worker-configuration.d.ts
bun run generate-jwt -- --secret "..." --email-id "..." --expires-in 900
```

CI runs `lint`, `typecheck`, and `test` on every push/PR to main.

## Architecture

Single-file worker at `src/index.ts` using Hono as the HTTP framework. The handler pipeline for `GET /`:

1. Check Cloudflare Cache API for a cached response
2. Validate env bindings (`RESEND_API_KEY`, `RESEND_JWT_SECRET`)
3. Extract and verify JWT from `?token=` query param (using `jose`)
4. Fetch email HTML from Resend API (using `resend` SDK)
5. Return HTML response; cache it if TTL > 0

Uses a Result pattern (`HandlerResult<T>`) for typed error propagation without exceptions—each step returns `{ok: true, value}` or `{ok: false, status, message}`.

## Testing

Tests live in `test/` and run inside the Workers runtime via `@cloudflare/vitest-pool-workers`. The Resend SDK is mocked with `vi.mock("resend")`. The test file imports the worker with a top-level `await import("../src/index")`. Test env bindings are typed via `test/env.d.ts`.

## Code Style

- Biome for linting and formatting (2-space indent, unused vars/imports are errors)
- TypeScript strict mode
- Package manager: bun (lockfile: `bun.lock`)
