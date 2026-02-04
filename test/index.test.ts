import {
  createExecutionContext,
  waitOnExecutionContext,
} from "cloudflare:test";
import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";

type ResendResponse = {
  data: { html: string } | null;
  error: { message: string } | null;
};

const resendCtor = vi.fn<(apiKey: string) => void>();
const resendEmailsGet = vi.fn(
  async (_emailId: string): Promise<ResendResponse> => ({
    data: { html: "<p>email-123</p>" },
    error: null,
  }),
);

vi.mock("resend", () => ({
  Resend: class {
    readonly emails: {
      get: (emailId: string) => Promise<ResendResponse>;
    };

    constructor(apiKey: string) {
      resendCtor(apiKey);
      this.emails = {
        get: (emailId: string) => resendEmailsGet(emailId),
      };
    }
  },
}));

function createToken(secret: string): Promise<string> {
  const issuedAt = Math.floor(Date.now() / 1000);
  return new SignJWT({ email_id: "email-123" })
    .setProtectedHeader({ alg: "HS256", typ: "JWT" })
    .setIssuedAt(issuedAt)
    .setExpirationTime(issuedAt + 120)
    .sign(new TextEncoder().encode(secret));
}

const baseEnv: Env = {
  RESEND_API_KEY: "test-api-key",
  RESEND_JWT_SECRET: "test-secret",
};

const worker = (await import("../src/index")).default;

beforeEach(() => {
  resendCtor.mockClear();
  resendEmailsGet.mockClear();
});

describe("resend link worker", () => {
  it("returns 400 when token is missing", async () => {
    const request = new Request("https://example.com/");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, { ...baseEnv }, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(400);
    expect(await response.text()).toBe("Token not provided");
    expect(resendEmailsGet).not.toHaveBeenCalled();
  });

  it("serves email html when token is valid", async () => {
    const token = await createToken(baseEnv.RESEND_JWT_SECRET);
    const url = new URL("https://example.com/");
    url.searchParams.set("token", token);

    const request = new Request(url.toString());
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, { ...baseEnv }, ctx);
    await waitOnExecutionContext(ctx);

    expect(resendCtor).toHaveBeenCalledWith("test-api-key");
    expect(resendEmailsGet).toHaveBeenCalledWith("email-123");
    const body = await response.text();
    expect(response.status).toBe(200);
    expect(body).toBe("<p>email-123</p>");

    const cacheControl = response.headers.get("cache-control");
    expect(cacheControl).not.toBeNull();
    if (cacheControl !== null) {
      expect(cacheControl.includes("max-age")).toBe(true);
    }

    const secondCtx = createExecutionContext();
    const secondResponse = await worker.fetch(
      new Request(url.toString()),
      { ...baseEnv },
      secondCtx,
    );
    await waitOnExecutionContext(secondCtx);

    expect(await secondResponse.text()).toBe("<p>email-123</p>");
    expect(resendEmailsGet).toHaveBeenCalledTimes(1);
  });
});
