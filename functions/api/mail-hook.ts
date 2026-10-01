import { json, type Env } from "../_lib/env";
import { hookKey, provider } from "../_lib/mailer";
import { ensureList } from "../_lib/list";

// The email service calls this when an email can't be delivered because the inbox doesn't exist, or a
// fan marks it as spam. Those addresses leave the list straight away, which keeps the band's sending
// reputation clean. The ?k= secret in the address keeps anyone else from calling it.
//   Resend:     JSON events, set up automatically by the admin.
//   Amazon SES: notifications arrive through Amazon SNS, which first asks this address to confirm itself.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  if (!provider(env) || !env.DB) return json({ ok: false }, 503);
  if (new URL(request.url).searchParams.get("k") !== (await hookKey(env))) return json({ ok: false }, 403);
  const body = JSON.parse((await request.text()) || "{}") as Record<string, any>;
  const gone: string[] = [];

  if (body.Type === "SubscriptionConfirmation" && /^https:\/\/sns\.[a-z0-9-]+\.amazonaws\.com\//.test(String(body.SubscribeURL ?? ""))) {
    await fetch(body.SubscribeURL);                       // tells Amazon this address really wants the notifications
    return json({ ok: true, confirmed: true });
  }
  if (body.Type === "Notification") {
    const m = JSON.parse(String(body.Message ?? "{}")) as Record<string, any>;
    const kind = String(m.notificationType ?? m.eventType ?? "");
    if (kind === "Bounce" && m.bounce?.bounceType === "Permanent") for (const r of m.bounce.bouncedRecipients ?? []) gone.push(String(r.emailAddress));
    if (kind === "Complaint") for (const r of m.complaint?.complainedRecipients ?? []) gone.push(String(r.emailAddress));
  } else if (typeof body.type === "string") {
    const to = ([] as string[]).concat(body.data?.to ?? []);
    if (body.type === "email.complained") gone.push(...to);
    if (body.type === "email.bounced" && !/transient|temporary/i.test(String(body.data?.bounce?.type ?? ""))) gone.push(...to);
  }
  const emails = gone.map((e) => e.trim().toLowerCase()).filter((e) => e.includes("@"));
  if (emails.length) {
    await ensureList(env.DB);
    await env.DB.prepare("DELETE FROM subscribers WHERE email IN (SELECT value FROM json_each(?))").bind(JSON.stringify(emails)).run();
  }
  return json({ ok: true, removed: emails.length });
};
