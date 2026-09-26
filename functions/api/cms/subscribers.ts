import { json, type Data, type Env } from "../../_lib/env";
import { ensureList, ON_LIST } from "../../_lib/list";
import { bouncerOn, creditsLeft } from "../../_lib/bouncer";

// The admin's mailing list: everyone on it (with each fan's private unsubscribe code, for the
// mail merge download), what the inbox check said, and how many paid checks are left.
export const onRequestGet: PagesFunction<Env, string, Data> = async ({ env }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  await ensureList(env.DB);
  // older sign-ups have no unsubscribe code yet: give them one
  await env.DB.prepare("UPDATE subscribers SET token = lower(hex(randomblob(20))) WHERE token IS NULL").run();
  const [{ results }, credits] = await Promise.all([
    env.DB.prepare(`SELECT email, name, token, verified, created_at FROM subscribers WHERE ${ON_LIST} ORDER BY created_at DESC`)
      .all<{ email: string; name: string | null; token: string; verified: string | null; created_at: string }>(),
    creditsLeft(env),
  ]);
  const stats = await env.DB.prepare("SELECT COUNT(*) AS checked, SUM(result = 'undeliverable') AS blocked FROM email_checks").first<{ checked: number; blocked: number | null }>();
  return json({ ok: true, subscribers: results, checks: { on: bouncerOn(env), credits, checked: stats?.checked ?? 0, blocked: stats?.blocked ?? 0 } });
};

// Remove one address (?email=) or many at once (body { emails: [...] }, e.g. addresses that bounced).
export const onRequestDelete: PagesFunction<Env, string, Data> = async ({ request, env }) => {
  if (!env.DB) return json({ ok: false, message: "The mailing list database isn't connected yet." }, 503);
  await ensureList(env.DB);
  const one = new URL(request.url).searchParams.get("email");
  const body = one ? null : ((await request.json().catch(() => ({}))) as { emails?: unknown });
  const emails = (one ? [one] : Array.isArray(body?.emails) ? body!.emails : []).map((e) => String(e).trim().toLowerCase()).filter((e) => e.includes("@")).slice(0, 2000);
  if (!emails.length) return json({ ok: false, message: "No email addresses found to remove." }, 400);
  const res = await env.DB.prepare("DELETE FROM subscribers WHERE email IN (SELECT value FROM json_each(?))").bind(JSON.stringify(emails)).run();
  return json({ ok: true, removed: res.meta.changes ?? 0 });
};
