import { json, type AuthContext, type EndpointRequest, type EndpointResponse } from "lakebed/server";
import type { ApiError, ValidationIssue } from "../shared/api";

type Env = Record<string, string | undefined>;

/**
 * Compares two strings without stopping at the first difference.
 * The app runtime has no Node `crypto`, so this is plain TypeScript: the loop
 * always runs over the longer string and the result does not depend on where
 * the strings differ. It is not a guarantee against every timing channel a
 * JavaScript engine has.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  const length = Math.max(a.length, b.length);
  let diff = a.length ^ b.length;
  for (let index = 0; index < length; index += 1) {
    const left = index < a.length ? a.charCodeAt(index) : 0;
    const right = index < b.length ? b.charCodeAt(index) : 0;
    diff |= left ^ right;
  }
  return diff === 0;
}

export function apiError(status: number, error: string, message: string, errors?: ValidationIssue[]): EndpointResponse {
  const body: ApiError = errors ? { ok: false, error, message, errors } : { ok: false, error, message };
  return json(body, { status });
}

/**
 * Checks `Authorization: Bearer <secret>` against the named server secret.
 * Returns null when the caller is authorized, or the response to send.
 */
export function checkBearer(env: Env, req: EndpointRequest, secretName: string): EndpointResponse | null {
  const secret = env[secretName];
  if (!secret) {
    return apiError(503, "not_configured", `The server secret ${secretName} is not set.`);
  }
  const header = req.headers.get("authorization") ?? "";
  const prefix = "Bearer ";
  const presented = header.startsWith(prefix) ? header.slice(prefix.length) : "";
  // Compare even when the header is malformed, so both cases take the same path.
  const matches = constantTimeEqual(presented, secret);
  if (!header.startsWith(prefix) || !matches) {
    return apiError(401, "unauthorized", "Send Authorization: Bearer <secret>.");
  }
  return null;
}

/** The Lakebed user ids allowed to read private data, from the OWNER_IDS server secret. */
export function ownerIds(env: Env): string[] {
  return (env.OWNER_IDS ?? "")
    .split(/[\s,]+/)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/**
 * True when the caller is signed in with Google and their account id is in OWNER_IDS.
 * The id is the account's stable `userId` (its token subject). Email is profile
 * data in Lakebed, not an authorization key, so it is not used.
 */
export function isOwner(auth: AuthContext, env: Env): boolean {
  if (!auth.isSignedIn || !auth.userId) {
    return false;
  }
  return ownerIds(env).includes(auth.userId);
}

/** Throws unless the caller is an owner. A guest, or nobody, is rejected by requireSignedIn. */
export function requireOwner(auth: AuthContext, env: Env): void {
  const account = auth.requireSignedIn();
  if (!ownerIds(env).includes(account.userId)) {
    throw new Error("Not authorized: this account is not an owner.");
  }
}
