import { Hono } from "hono";
import { type JWTPayload, jwtVerify } from "jose";
import { Resend } from "resend";

interface Env {
  RESEND_API_KEY: string;
  RESEND_JWT_SECRET: string;
}

type HandlerFailure = { ok: false; status: number; message: string };
type HandlerSuccess<T> = { ok: true; value: T };
type HandlerResult<T> = HandlerSuccess<T> | HandlerFailure;

const textEncoder = new TextEncoder();

const app = new Hono<{ Bindings: Env }>();

function success<T>(value: T): HandlerSuccess<T> {
  return { ok: true, value };
}

function failure(status: number, message: string): HandlerFailure {
  return { ok: false, status, message };
}

function createCacheKey(request: Request): Request {
  return new Request(request.url, request);
}

function createErrorResponse(message: string, status: number): Response {
  return new Response(message, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" },
  });
}

function createSuccessResponse(html: string, ttlSeconds: number): Response {
  const headers = new Headers({
    "content-type": "text/html; charset=utf-8",
  });
  if (ttlSeconds > 0) {
    headers.set(
      "cache-control",
      `public, max-age=${ttlSeconds}, s-maxage=${ttlSeconds}`,
    );
  } else {
    headers.set("cache-control", "no-store");
  }
  return new Response(html, { status: 200, headers });
}

function normalizeSecret(value: string): HandlerResult<string> {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return failure(500, "Server misconfigured");
  }
  return success(trimmed);
}

function validateEnv(
  env: Env,
): HandlerResult<{ apiKey: string; jwtSecret: string }> {
  const apiKeyResult = normalizeSecret(env.RESEND_API_KEY);
  if (!apiKeyResult.ok) {
    return apiKeyResult;
  }

  const jwtSecretResult = normalizeSecret(env.RESEND_JWT_SECRET);
  if (!jwtSecretResult.ok) {
    return jwtSecretResult;
  }

  return success({
    apiKey: apiKeyResult.value,
    jwtSecret: jwtSecretResult.value,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isResendClientError(value: unknown): value is { message: string } {
  if (!isRecord(value)) {
    return false;
  }
  const { message } = value;
  return typeof message === "string";
}

function extractEmailId(payload: JWTPayload): HandlerResult<string> {
  const candidate = payload.email_id;
  if (typeof candidate === "string" && candidate.length > 0) {
    return success(candidate);
  }
  return failure(400, "Token payload missing email_id");
}

async function resolveEmailId(
  token: string,
  jwtSecret: string,
): Promise<
  HandlerResult<{
    emailId: string;
    issuedAtSeconds: number;
    expiresAtSeconds: number;
  }>
> {
  try {
    const secretBytes = textEncoder.encode(jwtSecret);
    const verificationResult = await jwtVerify(token, secretBytes);
    const emailIdResult = extractEmailId(verificationResult.payload);
    if (!emailIdResult.ok) {
      return emailIdResult;
    }

    const { iat, exp } = verificationResult.payload;
    if (typeof iat !== "number" || typeof exp !== "number") {
      return failure(400, "Token missing required timestamps");
    }

    return success({
      emailId: emailIdResult.value,
      issuedAtSeconds: iat,
      expiresAtSeconds: exp,
    });
  } catch {
    return failure(401, "Invalid or expired token");
  }
}

async function fetchEmailHtml(
  emailId: string,
  apiKey: string,
): Promise<HandlerResult<string>> {
  try {
    const resend = new Resend(apiKey);
    const { data, error } = await resend.emails.get(emailId);
    if (error !== null && error !== undefined) {
      if (isResendClientError(error)) {
        return failure(502, error.message);
      }
      return failure(502, "Unable to fetch email");
    }

    if (data === null || data === undefined) {
      return failure(404, "Email not found");
    }

    const htmlCandidate = data.html;
    if (typeof htmlCandidate !== "string" || htmlCandidate.length === 0) {
      return failure(502, "Email body is unavailable");
    }

    return success(htmlCandidate);
  } catch {
    return failure(502, "Unable to fetch email");
  }
}

function extractTokenFromRequest(request: Request): HandlerResult<string> {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (token === null) {
    return failure(400, "Token not provided");
  }
  const trimmed = token.trim();
  if (trimmed.length === 0) {
    return failure(400, "Token not provided");
  }
  return success(trimmed);
}

app.get("/", async (c) => {
  const request = c.req.raw;
  const cacheKey = createCacheKey(request);
  const cache = caches.default;
  const cached = await cache.match(cacheKey);
  if (cached !== undefined) {
    return cached;
  }

  const envResult = validateEnv(c.env);
  if (!envResult.ok) {
    return createErrorResponse(envResult.message, envResult.status);
  }

  const tokenResult = extractTokenFromRequest(request);
  if (!tokenResult.ok) {
    return createErrorResponse(tokenResult.message, tokenResult.status);
  }

  const emailIdResult = await resolveEmailId(
    tokenResult.value,
    envResult.value.jwtSecret,
  );
  if (!emailIdResult.ok) {
    return createErrorResponse(emailIdResult.message, emailIdResult.status);
  }

  const emailHtmlResult = await fetchEmailHtml(
    emailIdResult.value.emailId,
    envResult.value.apiKey,
  );
  if (!emailHtmlResult.ok) {
    return createErrorResponse(emailHtmlResult.message, emailHtmlResult.status);
  }

  const maxAgeSeconds =
    emailIdResult.value.expiresAtSeconds - Math.floor(Date.now() / 1000);
  const response = createSuccessResponse(emailHtmlResult.value, maxAgeSeconds);
  if (maxAgeSeconds > 0) {
    c.executionCtx.waitUntil(cache.put(cacheKey, response.clone()));
  }
  return response;
});

app.notFound(() => createErrorResponse("Not Found", 404));

export default { fetch: app.fetch } satisfies ExportedHandler<Env>;
