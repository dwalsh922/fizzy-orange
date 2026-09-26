// The instant inbox check: Bouncer asks the fan's email provider whether the inbox exists, without sending
// anything. Pay as you go (about $8 for 1,000 checks; "unknown" answers are free). Only used when
// BOUNCER_API_KEY is set, and never blocks a sign-up because of a problem on Bouncer's side.
import type { Env } from "./env";

export type Inbox = "deliverable" | "risky" | "undeliverable" | "unknown" | "unchecked";
export const bouncerOn = (env: Env) => !!env.BOUNCER_API_KEY;
const base = (env: Env) => env.BOUNCER_API_BASE || "https://api.usebouncer.com/v1.1";

/** What Bouncer says about one address. "unchecked" = no key, out of credits, or Bouncer didn't answer in time. */
export async function checkInbox(env: Env, email: string): Promise<{ result: Inbox; reason: string; suggest?: string }> {
  if (!bouncerOn(env)) return { result: "unchecked", reason: "no key" };
  try {
    const r = await fetch(`${base(env)}/email/verify?email=${encodeURIComponent(email)}&timeout=4`, {
      headers: { "x-api-key": env.BOUNCER_API_KEY! }, signal: AbortSignal.timeout(5500),
    });
    if (!r.ok) return { result: "unchecked", reason: r.status === 402 ? "out of credits" : `bouncer ${r.status}` };
    const j = (await r.json()) as { status?: string; reason?: string; didYouMean?: string; domain?: { disposable?: string } };
    if (j.domain?.disposable === "yes") return { result: "undeliverable", reason: "disposable" };
    const result = (["deliverable", "risky", "undeliverable", "unknown"] as const).find((s) => s === j.status) ?? "unknown";
    return { result, reason: String(j.reason ?? ""), ...(j.didYouMean ? { suggest: String(j.didYouMean).toLowerCase() } : {}) };
  } catch {
    return { result: "unchecked", reason: "timed out" };
  }
}

/** Checks left on the account, for the admin. */
export async function creditsLeft(env: Env): Promise<number | null> {
  if (!bouncerOn(env)) return null;
  try {
    const r = await fetch(`${base(env)}/credits`, { headers: { "x-api-key": env.BOUNCER_API_KEY! }, signal: AbortSignal.timeout(6000) });
    if (!r.ok) return null;
    const j = (await r.json()) as { credits?: number };
    return typeof j.credits === "number" ? j.credits : null;
  } catch {
    return null;
  }
}
