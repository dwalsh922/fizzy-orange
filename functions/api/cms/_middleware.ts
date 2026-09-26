// Every /api/cms/* request must carry a valid Cloudflare Access login.
// Access also blocks these paths at the edge; this check is the second lock.
import { json, type Data, type Env } from "../../_lib/env";

type Jwk = JsonWebKey & { kid: string };
const b64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));

async function verifyAccess(token: string, env: Env): Promise<string | null> {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.replace(/\/+$/, "");
  const aud = env.CF_ACCESS_AUD;
  if (!team || !aud) return null;
  const [h, p, sig] = token.split(".");
  if (!h || !p || !sig) return null;
  const header = JSON.parse(new TextDecoder().decode(b64url(h))) as { kid?: string; alg?: string };
  if (header.alg !== "RS256") return null;
  const certs = (await (await fetch(`${team}/cdn-cgi/access/certs`, { cf: { cacheTtl: 3600 } } as RequestInit)).json()) as { keys: Jwk[] };
  const jwk = certs.keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64url(sig), new TextEncoder().encode(`${h}.${p}`));
  if (!ok) return null;
  const claims = JSON.parse(new TextDecoder().decode(b64url(p))) as { aud?: string | string[]; exp?: number; iss?: string; email?: string };
  const auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud) || !claims.exp || claims.exp * 1000 < Date.now() || claims.iss !== team) return null;
  return claims.email ?? null;
}

export const onRequest: PagesFunction<Env, string, Data> = async (ctx) => {
  const token = ctx.request.headers.get("Cf-Access-Jwt-Assertion");
  if (!ctx.env.CF_ACCESS_TEAM_DOMAIN || !ctx.env.CF_ACCESS_AUD) {
    return json({ ok: false, message: "Admin login isn't set up yet (Cloudflare Access settings missing)." }, 503);
  }
  const email = token ? await verifyAccess(token, ctx.env).catch(() => null) : null;
  if (!email) return json({ ok: false, message: "Please log in again." }, 401);
  ctx.data.email = email;
  try {
    return await ctx.next();
  } catch (e) {
    return json({ ok: false, message: e instanceof Error ? e.message : "Something went wrong." }, 500);
  }
};
