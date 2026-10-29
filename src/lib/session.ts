import { createHmac, timingSafeEqual } from "node:crypto";

// Single-user password gate. Cookie value = HMAC(password-derived secret, "someday") so a password change logs everyone out.
export const SESSION_COOKIE = "someday_session";
const secret = () => process.env.APP_PASSWORD ?? "";
export const gateEnabled = () => secret().length > 0;

export function sessionToken(): string {
  return createHmac("sha256", secret()).update("someday-session-v1").digest("hex");
}
export function validSession(cookie: string | undefined): boolean {
  if (!gateEnabled()) return true;
  if (!cookie) return false;
  const a = Buffer.from(cookie), b = Buffer.from(sessionToken());
  return a.length === b.length && timingSafeEqual(a, b);
}
export function passwordMatches(input: string): boolean {
  const a = Buffer.from(input), b = Buffer.from(secret());
  return a.length === b.length && timingSafeEqual(a, b);
}
