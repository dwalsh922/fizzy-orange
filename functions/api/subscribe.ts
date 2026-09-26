import { json, type Env } from "../_lib/env";
import { checkEmail } from "../_lib/email";
import { cleanName, ensureList, hashIp, newToken, ON_LIST } from "../_lib/list";
import { bouncerOn, checkInbox, type Inbox } from "../_lib/bouncer";

// Public mailing-list sign-up: first name + email.
//   1. Free checks: the shape, typos in common providers, throwaway inboxes, a domain that can't get email.
//   2. The instant inbox check (Bouncer, when BOUNCER_API_KEY is set): an inbox that doesn't exist is turned
//      away on the spot, so the fan can fix a typo. Anything Bouncer can't answer is let through.
// Fans already on the list, and addresses checked in the last 30 days, don't use a paid check.
const PER_VISITOR_PER_HOUR = 8;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, message: "Something went wrong. Try again." }, 400);
  if (String(form.get("company") ?? "")) return json({ ok: true, state: "joined", message: "You're on the list. See you down the front." }); // bot trap
  const name = cleanName(form.get("first_name"));
  if (!name) return json({ ok: false, field: "name", message: "Add your first name so we can say hi properly." }, 400);
  const check = await checkEmail(String(form.get("email") ?? ""), form.get("confirmed") === "1");
  if (!check.ok) return json({ ...check, field: "email" }, 400);
  if (!env.DB) return json({ ok: false, message: "Sign-ups open soon. Email the band in the meantime." }, 503);
  const db = env.DB;
  await ensureList(db);
  const email = check.email;

  const had = await db.prepare(`SELECT name, ${ON_LIST} AS on_list FROM subscribers WHERE email = ?`).bind(email).first<{ name: string | null; on_list: number }>();
  if (had?.on_list) {
    if (!had.name) await db.prepare("UPDATE subscribers SET name = ? WHERE email = ?").bind(name, email).run();
    return json({ ok: true, state: "already", message: `You're already on the list, ${name}. See you down the front.` });
  }

  // the instant inbox check, reusing a recent answer for the same address
  let inbox: { result: Inbox; reason: string; suggest?: string } = { result: "unchecked", reason: "no key" };
  if (bouncerOn(env)) {
    const seen = await db.prepare("SELECT result, reason FROM email_checks WHERE email = ? AND checked_at > datetime('now', '-30 days')").bind(email).first<{ result: Inbox; reason: string }>();
    if (seen) inbox = seen;
    else {
      const ip = await hashIp(request.headers.get("cf-connecting-ip") ?? "");
      const recent = await db.prepare("SELECT COUNT(*) AS n FROM email_checks WHERE ip = ? AND checked_at > datetime('now', '-1 hour')").bind(ip).first<{ n: number }>();
      if ((recent?.n ?? 0) >= PER_VISITOR_PER_HOUR) return json({ ok: false, message: "Lots of sign-ups from here in the last hour. Try again a bit later." }, 429);
      inbox = await checkInbox(env, email);
      if (inbox.result !== "unchecked") {
        await db.prepare("INSERT OR REPLACE INTO email_checks (email, result, reason, ip) VALUES (?, ?, ?, ?)").bind(email, inbox.result, inbox.reason, ip).run();
      }
    }
  }
  if (inbox.result === "undeliverable") {
    const fix = inbox.suggest && inbox.suggest !== email ? inbox.suggest : undefined;
    return json({
      ok: false, field: "email", ...(fix ? { suggest: fix } : {}),
      message: inbox.reason === "disposable" ? "Throwaway addresses can't join the list. Use your everyday email."
        : fix ? `We couldn't find an inbox at ${email}. Did you mean ${fix}?` : `We couldn't find an inbox at ${email}. Check the spelling and try again.`,
    }, 400);
  }

  await db.prepare(`INSERT INTO subscribers (email, name, status, token, confirmed_at, verified) VALUES (?, ?, 'confirmed', ?, datetime('now'), ?)
      ON CONFLICT (email) DO UPDATE SET name = excluded.name, status = 'confirmed', confirmed_at = datetime('now'), verified = excluded.verified, token = COALESCE(subscribers.token, excluded.token)`)
    .bind(email, name, newToken(), inbox.result).run();
  return json({ ok: true, state: "joined", message: `You're on the list, ${name}. See you down the front.` });
};
