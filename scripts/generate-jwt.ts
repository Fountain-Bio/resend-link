#!/usr/bin/env bun
import { SignJWT } from "jose";

interface ParsedArgs {
  readonly secret?: string;
  readonly emailId?: string;
  readonly expiresIn?: string;
}

interface ScriptOptions {
  readonly secret: string;
  readonly emailId: string;
  readonly expiresInSeconds: number;
}

const defaultExpiresInSeconds = 15 * 60;

function parseArgs(argv: string[]): ParsedArgs {
  const result: { secret?: string; emailId?: string; expiresIn?: string } = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) {
      continue;
    }
    const key = part.slice(2);
    const next = argv[index + 1];
    if (typeof next !== "string" || next.startsWith("--")) {
      continue;
    }
    if (key === "secret") {
      result.secret = next;
    } else if (key === "email-id") {
      result.emailId = next;
    } else if (key === "expires-in") {
      result.expiresIn = next;
    }
  }
  return result;
}

function parseOptions(args: ParsedArgs): ScriptOptions {
  const secret = args.secret ?? process.env.RESEND_JWT_SECRET;
  if (typeof secret !== "string" || secret.trim().length === 0) {
    throw new Error("Missing secret. Pass --secret or set RESEND_JWT_SECRET.");
  }

  const emailId = args.emailId ?? "";
  if (emailId.trim().length === 0) {
    throw new Error("Missing email id. Pass --email-id to continue.");
  }

  const expiresInRaw = args.expiresIn ?? String(defaultExpiresInSeconds);
  const expiresInSeconds = Number.parseInt(expiresInRaw, 10);
  if (!Number.isFinite(expiresInSeconds) || expiresInSeconds <= 0) {
    throw new Error("expires-in must be a positive integer (seconds).");
  }

  return {
    secret,
    emailId,
    expiresInSeconds,
  };
}

async function run(): Promise<void> {
  try {
    const parsedArgs = parseArgs(process.argv.slice(2));
    const options = parseOptions(parsedArgs);

    const issuedAt = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ email_id: options.emailId })
      .setProtectedHeader({ alg: "HS256", typ: "JWT" })
      .setIssuedAt(issuedAt)
      .setExpirationTime(issuedAt + options.expiresInSeconds)
      .sign(new TextEncoder().encode(options.secret));

    console.log("Email ID:", options.emailId);
    console.log("Issued At:", issuedAt);
    console.log("Expires At:", issuedAt + options.expiresInSeconds);
    console.log("JWT:", token);
  } catch (error) {
    if (error instanceof Error) {
      console.error(error.message);
      process.exitCode = 1;
      return;
    }
    console.error("Unknown error");
    process.exitCode = 1;
  }
}

run();
