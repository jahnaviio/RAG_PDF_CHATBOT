import { createRemoteJWKSet, jwtVerify, SignJWT } from "jose";
import type { NextFunction, Request, Response } from "express";
import { googleClientId, hasAuthSecret } from "./config.js";
import { query } from "./db.js";
import { HttpError } from "./errors.js";
import { parseCookies } from "./pure.js";

export interface SessionUser {
  id: string;
  email: string;
  name: string;
  picture: string | null;
}

const COOKIE = "rag_session";
const MAX_AGE_SECONDS = 60 * 60 * 24 * 30; // 30 days

const googleKeys = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

function secretKey(): Uint8Array {
  if (!hasAuthSecret()) {
    throw new HttpError(500, "AUTH_SECRET is not configured (use a random string of 16+ characters). Add it in Vercel and redeploy.");
  }
  return new TextEncoder().encode(process.env.AUTH_SECRET as string);
}

/** Verifies the ID token Google hands the browser after "Continue with Google". */
export async function verifyGoogleCredential(credential: string): Promise<SessionUser> {
  const clientId = googleClientId();
  if (!clientId) throw new HttpError(500, "GOOGLE_CLIENT_ID is not configured on the server.");
  let payload: any;
  try {
    ({ payload } = await jwtVerify(credential, googleKeys, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId,
    }));
  } catch {
    throw new HttpError(401, "Google sign-in could not be verified. Please try again.");
  }
  if (!payload.sub || !payload.email || payload.email_verified === false) {
    throw new HttpError(401, "Your Google account has no verified email address.");
  }
  return {
    id: String(payload.sub),
    email: String(payload.email).toLowerCase(),
    name: String(payload.name || payload.email),
    picture: payload.picture ? String(payload.picture) : null,
  };
}

export async function upsertUser(user: SessionUser): Promise<void> {
  await query(
    `insert into users (id, email, name, picture) values ($1, $2, $3, $4)
     on conflict (id) do update set email = excluded.email, name = excluded.name, picture = excluded.picture, last_login = now()`,
    [user.id, user.email, user.name, user.picture]
  );
}

export async function createSessionToken(user: SessionUser): Promise<string> {
  return new SignJWT({ email: user.email, name: user.name, picture: user.picture })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function readSession(req: Request): Promise<SessionUser | null> {
  const token = parseCookies(req.headers.cookie)[COOKIE];
  if (!token || !hasAuthSecret()) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    if (!payload.sub) return null;
    return {
      id: payload.sub,
      email: String(payload.email ?? ""),
      name: String(payload.name ?? payload.email ?? ""),
      picture: payload.picture ? String(payload.picture) : null,
    };
  } catch {
    return null;
  }
}

const isHttps = (req: Request) => req.secure || req.headers["x-forwarded-proto"] === "https";

export function setSessionCookie(req: Request, res: Response, token: string) {
  const parts = [`${COOKIE}=${encodeURIComponent(token)}`, "Path=/", "HttpOnly", "SameSite=Lax", `Max-Age=${MAX_AGE_SECONDS}`];
  if (isHttps(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

export function clearSessionCookie(req: Request, res: Response) {
  const parts = [`${COOKIE}=`, "Path=/", "HttpOnly", "SameSite=Lax", "Max-Age=0"];
  if (isHttps(req)) parts.push("Secure");
  res.setHeader("Set-Cookie", parts.join("; "));
}

/** Express middleware: only signed-in users get through. Puts the user on res.locals.user. */
export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const user = await readSession(req);
    if (!user) return res.status(401).json({ error: "Please sign in to continue." });
    res.locals.user = user;
    next();
  } catch (err) {
    next(err);
  }
}
