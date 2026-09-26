import { json, type Env } from "../_lib/env";
import { checkEmail } from "../_lib/email";
import { LIST_TABLE } from "../_lib/list";

// Public mailing-list sign-up. Every address is checked (typos, throwaway inboxes, a domain
// that can't get email) before it's stored in D1. Fans leave through /unsubscribe.
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const form = await request.formData().catch(() => null);
  if (!form) return json({ ok: false, message: "Something went wrong. Try again." }, 400);
  if (String(form.get("company") ?? "")) return json({ ok: true, message: "You're on the list." }); // bot trap
  const check = await checkEmail(String(form.get("email") ?? ""), form.get("confirmed") === "1");
  if (!check.ok) return json(check, 400);
  if (!env.DB) return json({ ok: false, message: "Sign-ups open soon. Email the band in the meantime." }, 503);
  const [, added] = await env.DB.batch([
    env.DB.prepare(LIST_TABLE),
    env.DB.prepare("INSERT OR IGNORE INTO subscribers (email) VALUES (?)").bind(check.email),
  ]);
  return json({ ok: true, message: added.meta.changes ? "You're on the list. See you down the front." : "You're already on the list. See you down the front." });
};
