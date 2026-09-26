// Brevo sends the emails (free plan: 300 a day). Without BREVO_API_KEY the list still works:
// sign-ups join straight away and the admin falls back to the mail app button.
import type { Env } from "./env";
import settings from "../../content/settings.json";

export const brevoOn = (env: Env) => !!env.BREVO_API_KEY;
export const senderEmail = () => String((settings as Record<string, string>).list_sender || (settings as Record<string, string>).email || "").trim();
const SENDER_NAME = "Fizzy Orange";

export async function brevo(env: Env, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch((env.BREVO_API_BASE || "https://api.brevo.com/v3") + path, {
    ...init,
    headers: { "api-key": env.BREVO_API_KEY ?? "", accept: "application/json", "content-type": "application/json", ...(init.headers ?? {}) },
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export type Mail = { to: { email: string; name?: string }; subject: string; html: string; text: string; headers?: Record<string, string>; tag: string };

/** Sends one email. `stop` means "don't try the rest now" (daily limit, bad key, sender not set up). */
export async function sendMail(env: Env, m: Mail): Promise<{ ok: true } | { ok: false; stop: boolean; message: string }> {
  const from = senderEmail();
  const r = await brevo(env, "/smtp/email", {
    method: "POST",
    body: JSON.stringify({
      sender: { name: SENDER_NAME, email: from }, replyTo: { email: from, name: SENDER_NAME },
      to: [m.to.name ? m.to : { email: m.to.email }], subject: m.subject, htmlContent: m.html, textContent: m.text,
      headers: m.headers, tags: [m.tag],
    }),
  });
  if (r.ok) return { ok: true };
  const msg = String(r.data?.message || `Brevo refused the email (${r.status}).`);
  // a problem with this one address: skip it and carry on; anything else: stop
  const oneAddress = r.status === 400 && /email|recipient|to\b/i.test(msg) && !/sender/i.test(msg);
  return { ok: false, stop: !oneAddress, message: msg };
}

/** A secret for the bounce webhook's address, derived from the API key so there's nothing extra to set up. */
export async function hookKey(env: Env): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode("fizzy-orange-hook:" + (env.BREVO_API_KEY ?? "")));
  return [...new Uint8Array(d)].slice(0, 16).map((b) => b.toString(16).padStart(2, "0")).join("");
}
