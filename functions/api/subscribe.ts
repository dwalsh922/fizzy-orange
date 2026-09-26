import { json, type Env } from "../_lib/env";

// Public mailing-list sign-up. Stores emails in D1 (free tier); export from the admin.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, message: "Something went wrong. Try again." }, 400);
  if (String(form.get("company") ?? "")) return json({ ok: true, message: "You're on the list." }); // bot trap
  const email = String(form.get("email") ?? "").trim().toLowerCase();
  if (email.length > 200 || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
    return json({ ok: false, message: "That doesn't look like an email address." }, 400);
  }
  if (!env.DB) return json({ ok: false, message: "Sign-ups open soon. Email the band in the meantime." }, 503);
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS subscribers (email TEXT PRIMARY KEY, created_at TEXT NOT NULL DEFAULT (datetime('now')))"),
    env.DB.prepare("INSERT OR IGNORE INTO subscribers (email) VALUES (?)").bind(email),
  ]);
  return json({ ok: true, message: "You're on the list. See you down the front." });
};
