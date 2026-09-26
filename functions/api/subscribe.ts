import { json, type Env } from "../_lib/env";
import { checkEmail } from "../_lib/email";
import { cleanName, ensureList, hashIp, newToken, ON_LIST } from "../_lib/list";
import { brevoOn, sendMail } from "../_lib/brevo";
import { confirmEmail } from "../_lib/templates";

// Public mailing-list sign-up: first name + email. The address is checked (typos, throwaway inboxes,
// a domain that can't get email). With Brevo connected the fan is "pending" until they tap the link
// in the confirmation email; without it they join straight away.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, message: "Something went wrong. Try again." }, 400);
  if (String(form.get("company") ?? "")) return json({ ok: true, state: "pending", message: "Nearly there! Check your inbox." }); // bot trap
  const name = cleanName(form.get("first_name"));
  if (!name) return json({ ok: false, field: "name", message: "Add your first name so we can say hi properly." }, 400);
  const check = await checkEmail(String(form.get("email") ?? ""), form.get("confirmed") === "1");
  if (!check.ok) return json({ ...check, field: "email" }, 400);
  if (!env.DB) return json({ ok: false, message: "Sign-ups open soon. Email the band in the meantime." }, 503);
  const db = env.DB;
  await ensureList(db);
  const email = check.email;
  const had = await db.prepare(`SELECT email, name, status, token, confirm_sent_at, ${ON_LIST} AS on_list FROM subscribers WHERE email = ?`).bind(email)
    .first<{ name: string | null; status: string | null; token: string | null; confirm_sent_at: string | null; on_list: number }>();

  if (had?.on_list) {
    if (!had.name) await db.prepare("UPDATE subscribers SET name = ? WHERE email = ?").bind(name, email).run();
    return json({ ok: true, state: "already", message: `You're already on the list, ${name}. See you down the front.` });
  }

  if (!brevoOn(env)) {
    // no email service yet: join straight away, exactly as before
    await db.prepare("INSERT INTO subscribers (email, name, status, token, confirmed_at) VALUES (?, ?, 'confirmed', ?, datetime('now')) ON CONFLICT (email) DO UPDATE SET name = excluded.name, status = 'confirmed', confirmed_at = datetime('now')")
      .bind(email, name, newToken()).run();
    return json({ ok: true, state: "joined", message: `You're on the list, ${name}. See you down the front.` });
  }

  const ip = await hashIp(request.headers.get("cf-connecting-ip") ?? "");
  const recent = await db.prepare("SELECT COUNT(*) AS n FROM subscribers WHERE ip = ? AND status = 'pending' AND created_at > datetime('now', '-1 hour')").bind(ip).first<{ n: number }>();
  if (!had && (recent?.n ?? 0) >= 5) return json({ ok: false, message: "Lots of sign-ups from here in the last hour. Try again a bit later." }, 429);

  const token = had?.token || newToken();
  if (had) await db.prepare("UPDATE subscribers SET name = ?, token = ? WHERE email = ?").bind(name, token, email).run();
  else await db.prepare("INSERT INTO subscribers (email, name, status, token, ip) VALUES (?, ?, 'pending', ?, ?)").bind(email, name, token, ip).run();

  // send the confirmation (not again within two minutes, so the form can't be used to flood an inbox)
  const lastSent = had?.confirm_sent_at ? Date.parse(had.confirm_sent_at.replace(" ", "T") + "Z") : 0;
  if (Date.now() - lastSent > 2 * 60 * 1000) {
    const origin = new URL(request.url).origin;
    const m = confirmEmail(origin, name, `${origin}/api/confirm?t=${token}`);
    const sent = await sendMail(env, { to: { email, name }, ...m, tag: "confirm" });
    if (sent.ok) await db.prepare("UPDATE subscribers SET confirm_sent_at = datetime('now') WHERE email = ?").bind(email).run();
  }
  return json({ ok: true, state: "pending", email, message: `Nearly there, ${name}! We've sent an email to ${email}. Tap the button in it to confirm and you're in.` });
};
