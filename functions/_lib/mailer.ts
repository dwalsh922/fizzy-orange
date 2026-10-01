// Delivers the designed emails. Two providers behind one door:
//   Resend      (RESEND_API_KEY)                    free for 3,000 emails a month, 100 a day
//   Amazon SES  (AWS_ACCESS_KEY_ID + SECRET + REGION) $0.10 per 1,000 emails, no monthly fee
// SES wins when both are set, so moving past Resend's daily cap is only a matter of adding the AWS
// values in Cloudflare. Neither adds any branding to the email.
import type { Env } from "./env";
import settings from "../../content/settings.json";

const S = settings as Record<string, string>;
// The address emails come from has to be on a domain the band controls and has verified with the
// email service. Mailbox providers (Gmail, Outlook and so on) don't let anyone else send as them.
const MAILBOX = /@(gmail|googlemail|outlook|hotmail|live|msn|yahoo|ymail|icloud|me|mac|aol|proton|protonmail|pm|gmx|eircom)\.[a-z.]+$/i;
export const sender = () => ({
  email: String(S.list_sender || "").trim(), name: String(S.list_sender_name || "Fizzy Orange").trim(),
  replyTo: String(S.list_reply_to || S.list_sender || S.email || "").trim(),
});
/** Why the list can't be emailed yet, in plain words; null when the sending address is usable. */
export function senderProblem(): string | null {
  const { email } = sender();
  if (!email) return "No sending address is set yet. Once the band's address is ready, set it under Website text (\"Mailing list emails come from\").";
  if (MAILBOX.test(email)) return `${email} can't be used to send from: ${email.split("@")[1]} doesn't let email services send as its addresses. Use an address on a domain the band owns (for example hello@fizzyorange.ie); replies can still go to a Gmail address.`;
  return null;
}
export type Provider = "ses" | "resend" | null;
export const provider = (env: Env): Provider =>
  env.AWS_ACCESS_KEY_ID && env.AWS_SECRET_ACCESS_KEY ? "ses" : env.RESEND_API_KEY ? "resend" : null;

export type Msg = { to: string; name?: string; subject: string; html: string; text: string; unsub?: string };
// one answer per message. `stop` = don't try the rest now (daily limit, bad key, domain not verified)
export type Sent = { ok: true } | { ok: false; stop: boolean; message: string };

const fromLine = (addr?: string) => { const s = sender(); return `${s.name} <${addr || s.email}>`; };
const unsubHeaders = (m: Msg): Record<string, string> =>
  m.unsub ? { "List-Unsubscribe": `<${m.unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } : {};

/* ---------------- Resend ---------------- */
const resendBase = (env: Env) => env.MAIL_API_BASE || "https://api.resend.com";
export async function resend(env: Env, path: string, init: RequestInit = {}): Promise<{ ok: boolean; status: number; data: any }> {
  const r = await fetch(resendBase(env) + path, { ...init, headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json", ...(init.headers ?? {}) } });
  return { ok: r.ok, status: r.status, data: await r.json().catch(() => ({})) };
}
async function sendResend(env: Env, msgs: Msg[], from?: string): Promise<Sent[]> {
  const replyTo = sender().replyTo;
  const body = msgs.map((m) => ({ from: fromLine(from), to: [m.to], ...(replyTo ? { reply_to: replyTo } : {}), subject: m.subject, html: m.html, text: m.text, headers: unsubHeaders(m) }));
  const r = await resend(env, "/emails/batch", { method: "POST", body: JSON.stringify(body) });
  if (r.ok) return msgs.map(() => ({ ok: true }));
  const name = String(r.data?.name ?? ""), text = String(r.data?.message ?? `Resend refused the email (${r.status}).`);
  const message = name === "daily_quota_exceeded" ? "Resend's free plan has sent its 100 emails for today. The rest can go tomorrow."
    : name === "monthly_quota_exceeded" ? "Resend's monthly allowance is used up."
    : text;
  // a batch is all or nothing. One bad address fails the lot, so try them one at a time to find it;
  // and near the daily limit, send one at a time so the last few of today's allowance still go
  const quota = r.status === 429 && name === "daily_quota_exceeded";
  if ((r.status === 422 || quota) && msgs.length > 1) {
    const out: Sent[] = [];
    let stopped: Sent | null = null;
    for (const m of msgs) {
      if (stopped) { out.push(stopped); continue; }
      const [one] = await sendResend(env, [m], from);
      out.push(one);
      if (!one.ok && one.stop) stopped = one;
    }
    return out;
  }
  const oneAddress = r.status === 422 && msgs.length === 1 && /\bto\b|recipient|address/i.test(text) && !/domain|from/i.test(text);
  return msgs.map(() => ({ ok: false, stop: !oneAddress, message }));
}

/* ---------------- Amazon SES (API v2, signed with Signature Version 4) ---------------- */
const enc = new TextEncoder();
const hex = (b: ArrayBuffer) => [...new Uint8Array(b)].map((x) => x.toString(16).padStart(2, "0")).join("");
const sha256 = async (s: string) => hex(await crypto.subtle.digest("SHA-256", enc.encode(s)));
async function hmac(key: ArrayBuffer | Uint8Array, data: string): Promise<ArrayBuffer> {
  const k = await crypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return crypto.subtle.sign("HMAC", k, enc.encode(data));
}
/** The Authorization header for one AWS request. Exported so the signing can be checked against AWS's own examples. */
export async function awsAuth(o: { method: string; host: string; path: string; query?: string; body: string; headers: Record<string, string>; region: string; service: string; keyId: string; secret: string; amzDate: string }): Promise<string> {
  const date = o.amzDate.slice(0, 8);
  const all: Record<string, string> = { host: o.host, "x-amz-date": o.amzDate, ...o.headers };
  const names = Object.keys(all).map((n) => n.toLowerCase()).sort();
  const lower: Record<string, string> = {}; for (const [k, v] of Object.entries(all)) lower[k.toLowerCase()] = v.trim().replace(/\s+/g, " ");
  const canonical = [o.method, o.path, o.query ?? "", names.map((n) => `${n}:${lower[n]}\n`).join(""), names.join(";"), await sha256(o.body)].join("\n");
  const scope = `${date}/${o.region}/${o.service}/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", o.amzDate, scope, await sha256(canonical)].join("\n");
  let key = await hmac(enc.encode("AWS4" + o.secret), date);
  for (const part of [o.region, o.service, "aws4_request"]) key = await hmac(key, part);
  return `AWS4-HMAC-SHA256 Credential=${o.keyId}/${scope}, SignedHeaders=${names.join(";")}, Signature=${hex(await hmac(key, toSign))}`;
}
async function sendSesOne(env: Env, m: Msg): Promise<Sent> {
  const region = env.AWS_REGION || "eu-west-1";
  const host = `email.${region}.amazonaws.com`, path = "/v2/email/outbound-emails";
  const s = sender();
  const body = JSON.stringify({
    FromEmailAddress: fromLine(), Destination: { ToAddresses: [m.to] }, ...(s.replyTo ? { ReplyToAddresses: [s.replyTo] } : {}),
    Content: { Simple: {
      Subject: { Data: m.subject, Charset: "UTF-8" },
      Body: { Html: { Data: m.html, Charset: "UTF-8" }, Text: { Data: m.text, Charset: "UTF-8" } },
      Headers: Object.entries(unsubHeaders(m)).map(([Name, Value]) => ({ Name, Value })),
    } },
  });
  const amzDate = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+/, "");
  const headers = { "content-type": "application/json" };
  const authorization = await awsAuth({ method: "POST", host, path, body, headers, region, service: "ses", keyId: env.AWS_ACCESS_KEY_ID!, secret: env.AWS_SECRET_ACCESS_KEY!, amzDate });
  const r = await fetch((env.MAIL_API_BASE || `https://${host}`) + path, { method: "POST", body, headers: { ...headers, "x-amz-date": amzDate, authorization } });
  if (r.ok) return { ok: true };
  const j = (await r.json().catch(() => ({}))) as { message?: string; Message?: string };
  const text = String(j.message ?? j.Message ?? `Amazon SES refused the email (${r.status}).`);
  // SES answers 400 for one unusable address (or one that asked never to be emailed); anything else stops the run
  const oneAddress = r.status === 400 && /address|recipient|suppress|destination/i.test(text) && !/not verified|sandbox|identity/i.test(text);
  return { ok: false, stop: !oneAddress, message: /sandbox|not verified/i.test(text) ? `Amazon SES: ${text} (New SES accounts can only send to verified addresses until Amazon approves "production access".)` : `Amazon SES: ${text}` };
}
async function sendSes(env: Env, msgs: Msg[]): Promise<Sent[]> {
  const out: Sent[] = new Array(msgs.length);
  let next = 0, stopped: Sent | null = null;
  // five at a time: comfortably inside SES's starting rate of 14 a second
  await Promise.all(Array.from({ length: Math.min(5, msgs.length) }, async () => {
    while (next < msgs.length) {
      const i = next++;
      if (stopped) { out[i] = stopped; continue; }
      out[i] = await sendSesOne(env, msgs[i]);
      const r = out[i];
      if (!r.ok && r.stop) stopped = r;
    }
  }));
  return out;
}

/** Sends a batch (the caller keeps batches to 25 or fewer). `from` overrides the address, for Resend's test sender. */
export async function sendMany(env: Env, msgs: Msg[], from?: string): Promise<Sent[]> {
  const p = provider(env);
  if (!p) return msgs.map(() => ({ ok: false, stop: true, message: "No email service is connected yet." }));
  try { return p === "ses" ? await sendSes(env, msgs) : await sendResend(env, msgs, from); }
  catch (e) { return msgs.map(() => ({ ok: false, stop: true, message: e instanceof Error ? e.message : "The email service didn't answer." })); }
}

/** A secret for the bounce webhook's address, derived from the provider's key so there's nothing extra to set up. */
export async function hookKey(env: Env): Promise<string> {
  return (await sha256("fizzy-orange-hook:" + (env.AWS_SECRET_ACCESS_KEY || env.RESEND_API_KEY || ""))).slice(0, 32);
}
